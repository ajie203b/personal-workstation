import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ClipboardCopy,
  Copy,
  FileText,
  ImagePlus,
  ListTodo,
  Loader2,
  X,
} from 'lucide-react'
import { IconToolOcr } from '@/shared/icons'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { importDoc } from '@/db/docs'
import { addTask } from '@/db/tasks'
import { LOW_CONFIDENCE, type Quad } from './ocrPipeline'
import type { OcrLine, OcrProgress } from './ocrEngine'

/** 送进 Worker 的像素与尺寸 */
interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * 图片文件 → RGBA 像素 + 预览 URL。
 * 长边压到 1600 以内：手机原图动辄 4000px，全尺寸送检测既慢又吃内存，
 * 而文字行在 1600px 下已经足够清晰。
 */
async function fileToRgba(file: Blob): Promise<{ pixels: RgbaImage; objectUrl: string; naturalWidth: number; naturalHeight: number }> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片加载失败'))
      el.src = objectUrl
    })
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh) throw new Error('图片尺寸为空')
    const ratio = Math.min(1, 1600 / Math.max(nw, nh))
    const w = Math.max(1, Math.round(nw * ratio))
    const h = Math.max(1, Math.round(nh * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 不可用')
    ctx.drawImage(img, 0, 0, w, h)
    const pixels = ctx.getImageData(0, 0, w, h)
    return { pixels: { data: pixels.data, width: w, height: h }, objectUrl, naturalWidth: nw, naturalHeight: nh }
  } catch (e) {
    URL.revokeObjectURL(objectUrl)
    throw e
  }
}

/** 复制文本：优先系统剪贴板，不支持时退回临时 textarea + execCommand（WebView 常见） */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('复制失败')
}

/** Windows/安卓文件名非法字符换空格 */
function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'OCR 识别结果'
}

/** 四点框 → SVG polygon 点串 */
function polygonPoints(box: Quad): string {
  return box.map((p) => `${p.x},${p.y}`).join(' ')
}

/** 进度条：下载模型与推理各一段 */
function OcrProgressBar({ progress, onCancel }: { progress: OcrProgress | null; onCancel: () => void }) {
  if (!progress) return null
  const percent = progress.ratio < 0 ? 0 : Math.round(progress.ratio * 100)
  const label = progress.phase === 'download' ? '下载模型' : '本地识别'
  return (
    <section className="card p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <Loader2 size={15} className="animate-spin text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium">{label}…</p>
            <p className="text-[11.5px] text-on-surface-2 tabular-nums">
              {progress.ratio < 0 ? '下载中' : `${percent}%`}
            </p>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-[width] duration-200', progress.ratio < 0 ? 'animate-pulse w-1/3' : 'bg-primary')}
              style={progress.ratio < 0 ? undefined : { width: `${percent}%` }}
            />
          </div>
        </div>
        <Button onClick={onCancel} variant="outline" size="sm" className="h-8 px-3 shrink-0">
          <X size={14} /> 取消
        </Button>
      </div>
    </section>
  )
}

/**
 * 本地 OCR（v3.3）：拍照 / 相册 / 粘贴截图取文字。
 *
 * 模型（PP-OCRv4 mobile det+rec + ppocr 字典）首次使用时下载并缓存在本机，
 * 之后全程离线：检测出文本框 → 图上叠框（点框复制该行、低置信度标黄）→
 * 右侧全文可编辑 → 复制 / 存为 MD 文档 / 转任务。识别在本地完成，图片不上传。
 */
export function OcrPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const [pixels, setPixels] = useState<RgbaImage | null>(null)
  const [objectUrl, setObjectUrl] = useState('')
  const [lines, setLines] = useState<OcrLine[]>([])
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const runIdRef = useRef(0)

  /** 停掉进行中的识别：先协作取消，再兜底 terminate（模型缓存不受影响） */
  const stopWorker = useCallback(() => {
    const w = workerRef.current
    if (w) {
      try {
        w.postMessage({ type: 'cancel', id: runIdRef.current })
      } catch {
        /* worker 已挂 */
      }
      w.terminate()
    }
    workerRef.current = null
    setProgress(null)
  }, [])

  useEffect(() => () => stopWorker(), [stopWorker])

  /** 图片来源（相册/拍照/粘贴）统一入口：解码 → 建 Worker → 跑管线 */
  const handleImageSource = useCallback(
    async (file: Blob) => {
      stopWorker()
      setError('')
      setLines([])
      setText('')
      setProgress({ phase: 'download', ratio: 0 })
      try {
        const { pixels: px, objectUrl: url } = await fileToRgba(file)
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        setObjectUrl(url)
        setPixels(px)

        const id = ++runIdRef.current
        const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data as
            | { type: 'progress'; id: number; progress: OcrProgress }
            | { type: 'done'; id: number; lines: OcrLine[] }
            | { type: 'error'; id: number; message: string; aborted: boolean }
          if (msg.id !== id) return
          if (msg.type === 'progress') {
            setProgress(msg.progress)
            return
          }
          if (msg.type === 'done') {
            setLines(msg.lines)
            setText(msg.lines.map((l) => l.text).join('\n'))
            setProgress(null)
            workerRef.current = null
            if (msg.lines.length) toast(`识别到 ${msg.lines.length} 行文字`)
            else toast('没有识别到文字，换一张更清晰的图再试')
            return
          }
          // error
          setProgress(null)
          workerRef.current = null
          if (msg.aborted) return
          setError(msg.message || '识别失败')
          toast(msg.message || '识别失败')
        }
        worker.onerror = () => {
          if (runIdRef.current !== id) return
          setProgress(null)
          workerRef.current = null
          const msg = '识别进程异常退出，请重试'
          setError(msg)
          toast(msg)
        }
        // 像素 buffer 传给 Worker（transfer，主线程这份不再用）
        worker.postMessage({ type: 'run', id, width: px.width, height: px.height, rgba: px.data.buffer }, [px.data.buffer])
      } catch (e) {
        setProgress(null)
        const msg = e instanceof Error ? e.message : '图片读取失败'
        setError(msg)
        toast(msg)
      }
    },
    [objectUrl, stopWorker, toast],
  )

  // 粘贴图片识别（ref 转发最新处理函数，监听只挂一次）
  const imageHandlerRef = useRef(handleImageSource)
  useEffect(() => {
    imageHandlerRef.current = handleImageSource
  })
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (!img) return
      e.preventDefault()
      void imageHandlerRef.current(img)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  /** 点框复制该行 */
  const onBoxClick = async (line: OcrLine) => {
    try {
      await copyText(line.text)
      toast('已复制该行')
    } catch {
      toast('复制失败')
    }
  }

  const doCopyAll = async () => {
    if (!text.trim()) return
    try {
      await copyText(text)
      toast('已复制全文')
    } catch {
      toast('复制失败')
    }
  }

  /** 存为 MD 文档（v1 只做「存为新文档」） */
  const doSaveDoc = async () => {
    if (!text.trim() || saving) return
    setSaving('doc')
    try {
      const title = safeName(text.trim().split('\n')[0] ?? '')
      const file = new File([text], `${title}.md`, { type: 'text/markdown' })
      const { doc, duplicated } = await importDoc(file)
      toast(duplicated ? `内容已存在《${doc.title}》` : '已存入文档库')
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving('')
    }
  }

  /** 转任务：标题取前 30 字 */
  const doAddTask = async () => {
    if (!text.trim() || saving) return
    setSaving('task')
    try {
      const title = text.replace(/\s+/g, ' ').trim().slice(0, 30)
      await addTask({ title, tier: 'today', notes: text })
      toast('已转为任务')
    } catch (e) {
      toast(e instanceof Error ? e.message : '转任务失败')
    } finally {
      setSaving('')
    }
  }

  const lowConfidence = lines.filter((l) => l.confidence < LOW_CONFIDENCE).length

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolOcr size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">本地 OCR</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            拍照 / 截图取文字，点框复制、存为文档，识别在本地完成
          </p>
        </div>
      </header>

      {/* 输入区 */}
      <section className="card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void handleImageSource(f)
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} variant="primary" className="h-9 px-4">
            <ImagePlus size={15} /> 拍照 / 相册
          </Button>
          {objectUrl && (
            <Button
              onClick={() => {
                stopWorker()
                setError('')
                setLines([])
                setText('')
                if (objectUrl) URL.revokeObjectURL(objectUrl)
                setObjectUrl('')
                setPixels(null)
              }}
              variant="ghost"
              className="h-9 px-3"
            >
              <X size={15} /> 清除
            </Button>
          )}
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed">也可以直接 Ctrl+V 粘贴截图</p>
        </div>
      </section>

      <OcrProgressBar progress={progress} onCancel={stopWorker} />

      {error && (
        <section className="card p-4 border-danger/40">
          <p className="text-[13px] text-danger leading-relaxed">{error}</p>
          <p className="text-[11.5px] text-on-surface-2 mt-1 leading-relaxed">
            模型下载或识别失败时会保留已下载的部分缓存，网络恢复后重试即可。
          </p>
        </section>
      )}

      {pixels && objectUrl ? (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* 图 + 叠加识别框 */}
          <section className="card p-3 flex flex-col gap-2">
            <div className="relative rounded-[10px] overflow-hidden bg-surface-2">
              <img src={objectUrl} alt="待识别图片" className="block w-full h-auto select-none" draggable={false} />
              {lines.length > 0 && (
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox={`0 0 ${pixels.width} ${pixels.height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {lines.map((line, i) => (
                    <polygon
                      key={i}
                      points={polygonPoints(line.box)}
                      fill={line.confidence < LOW_CONFIDENCE ? 'rgba(250, 204, 21, 0.22)' : 'rgba(44, 85, 184, 0.16)'}
                      stroke={line.confidence < LOW_CONFIDENCE ? '#EAB308' : '#2C55B8'}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      className="cursor-pointer"
                      onClick={() => void onBoxClick(line)}
                    >
                      <title>{line.text}</title>
                    </polygon>
                  ))}
                </svg>
              )}
            </div>
            <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
              {lines.length > 0 ? (
                <>
                  点识别框复制该行；黄色为低置信度（&lt; 0.75）建议核对
                  {lowConfidence > 0 && <span className="text-warning"> · {lowConfidence} 行偏低</span>}
                </>
              ) : (
                '识别完成后，文本框会叠加在图上'
              )}
            </p>
          </section>

          {/* 全文编辑 + 出口 */}
          <section className="card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13.5px] font-semibold">识别结果</h2>
              {lines.length > 0 && <span className="text-[11px] text-on-surface-2">{lines.length} 行</span>}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              placeholder={progress ? '识别中…' : '识别出的文字会出现在这里，可直接编辑'}
              className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[220px]"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => void doCopyAll()} disabled={!text.trim()} variant="outline" className="h-9 px-4">
                <Copy size={15} /> 复制全文
              </Button>
              <Button onClick={() => void doSaveDoc()} disabled={!text.trim() || Boolean(saving)} variant="primary" className="h-9 px-4">
                {saving === 'doc' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} 存为 MD 文档
              </Button>
              <Button onClick={() => void doAddTask()} disabled={!text.trim() || Boolean(saving)} variant="outline" className="h-9 px-4">
                {saving === 'task' ? <Loader2 size={15} className="animate-spin" /> : <ListTodo size={15} />} 转任务
              </Button>
            </div>
            <p className="text-[11px] text-on-surface-2 leading-relaxed">
              「转任务」把前 30 字作为标题、全文写进备注；「存为 MD 文档」进文档库，可继续编辑或加入阅读流程。
            </p>
          </section>
        </div>
      ) : (
        !progress &&
        !error && (
          <EmptyState
            icon={ClipboardCopy}
            title="还没有待识别的图片"
            hint="拍照、从相册选图，或直接 Ctrl+V 粘贴截图，识别框与文字会显示在这里。"
          />
        )
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        识别在本地完成，图片不上传。首次使用需下载模型（约 16MB，缓存在本机），之后离线可用。
      </p>
    </div>
  )
}
