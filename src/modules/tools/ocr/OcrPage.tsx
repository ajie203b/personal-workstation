import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Camera,
  ClipboardCopy,
  Copy,
  FilePlus2,
  FileText,
  ImagePlus,
  ListTodo,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { IconToolOcr } from '@/shared/icons'
import { ToolIconTile } from '@/shared/ui/ToolIconTile'
import { BackButton } from '@/shared/ui/BackButton'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { importDoc } from '@/db/docs'
import { addTask } from '@/db/tasks'
import {
  LOW_CONFIDENCE,
  formatOcrLines,
  type OcrFormatMode,
  type Quad,
} from './ocrPipeline'
import type { OcrLine, OcrProgress } from './ocrEngine'
import { recognizePixelsOnSharedWorker } from './ocrClient'

/** 送进 Worker 的像素与尺寸 */
interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface OcrPageResult {
  id: string
  objectUrl: string
  width: number
  height: number
  lines: OcrLine[]
}

const FORMAT_OPTIONS: { value: OcrFormatMode; label: string }[] = [
  { value: 'smart', label: '智能排版' },
  { value: 'raw', label: '逐行原文' },
  { value: 'table', label: 'Markdown 表格' },
]

/**
 * 图片文件 → RGBA 像素 + 预览 URL。
 * 只按「短边 ≤ 1600 且总像素 ≤ 2000 万」缩：旧版按长边 1600 压，
 * 1080×2400 的截图会先被压到 720 宽，长截图更是压到字都糊了。
 * 检测阶段另有切块（ocrPipeline.planDetTiles），这里保留足够分辨率给识别用。
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
    const ratio = Math.min(1, 1600 / Math.min(nw, nh), Math.sqrt(20_000_000 / (nw * nh)))
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

/** 进度条：下载模型与推理各一段，多图队列显示当前张数 */
function OcrProgressBar({
  progress,
  queuePos,
  onCancel,
}: {
  progress: OcrProgress | null
  queuePos: { current: number; total: number } | null
  onCancel: () => void
}) {
  if (!progress) return null
  const percent = progress.ratio < 0 ? 0 : Math.round(progress.ratio * 100)
  const baseLabel = progress.phase === 'download' ? '下载模型' : '本地识别'
  const label = queuePos && queuePos.total > 1 ? `${baseLabel}（第 ${queuePos.current}/${queuePos.total} 张）` : baseLabel
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
 * 本地 OCR（v3.3）：拍照 / 相册 / 粘贴截图取文字（支持多图队列追加与分栏/表格排版）。
 *
 * 模型（PP-OCRv4 mobile det+rec + ppocr 字典）首次使用时下载并缓存在本机，
 * 之后复用常驻热 Worker 与 ONNX 会话全程离线识别：图上叠框可键盘/点击复制该行、
 * 支持关键词检索高亮、三种排版切换、复制 / 存为 MD 文档 / 转任务。图片不上传。
 */
export function OcrPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const [pages, setPages] = useState<OcrPageResult[]>([])
  const [activePageIdx, setActivePageIdx] = useState(0)
  const [formatMode, setFormatMode] = useState<OcrFormatMode>('smart')
  const [text, setText] = useState('')
  const [appendNext, setAppendNext] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBoxIdx, setSelectedBoxIdx] = useState<number | null>(null)

  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [queuePos, setQueuePos] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [savingTask, setSavingTask] = useState(false)

  const saveDocBtn = useAsyncButton({ successHoldMs: 900 })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const appendInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const abortCtrlRef = useRef<AbortController | null>(null)
  const manualEditedRef = useRef(false)
  const batchTokenRef = useRef(0)
  const pagesRef = useRef<OcrPageResult[]>([])
  const formatModeRef = useRef<OcrFormatMode>(formatMode)
  const lastInputRef = useRef<{ files: Blob[]; append: boolean } | null>(null)

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => {
    formatModeRef.current = formatMode
  }, [formatMode])

  /** 取消当前进行中的识别批次 */
  const cancelActiveRun = useCallback(() => {
    batchTokenRef.current++
    abortCtrlRef.current?.abort()
    abortCtrlRef.current = null
    setProgress(null)
    setQueuePos(null)
  }, [])

  /** 组件卸载时中止进行中的识别并释放所有图片 Blob URL（空闲共享 Worker 由 ocrClient 3 分钟后自动回收） */
  const disposeOnUnmount = useCallback(() => {
    batchTokenRef.current++
    abortCtrlRef.current?.abort()
    abortCtrlRef.current = null
    for (const p of pagesRef.current) URL.revokeObjectURL(p.objectUrl)
  }, [])

  useEffect(() => disposeOnUnmount, [disposeOnUnmount])

  const revokePages = useCallback((list: OcrPageResult[]) => {
    for (const p of list) URL.revokeObjectURL(p.objectUrl)
  }, [])

  /** 图片队列统一入口：单张替换或多张顺序识别追加，全程复用 ocrClient 共享热 Worker */
  const handleFiles = useCallback(
    async (fileList: Blob[], append: boolean) => {
      if (!fileList.length) return
      const token = ++batchTokenRef.current
      lastInputRef.current = { files: fileList, append }

      abortCtrlRef.current?.abort()
      const controller = new AbortController()
      abortCtrlRef.current = controller

      setError('')
      setSearchQuery('')
      setSelectedBoxIdx(null)

      if (!append) {
        revokePages(pagesRef.current)
        setPages([])
        setActivePageIdx(0)
        manualEditedRef.current = false
        setText('')
      }

      let totalNewLines = 0
      try {
        for (let i = 0; i < fileList.length; i++) {
          if (batchTokenRef.current !== token) return
          setQueuePos({ current: i + 1, total: fileList.length })
          setProgress({ phase: 'infer', ratio: 0 })

          const { pixels: px, objectUrl } = await fileToRgba(fileList[i])
          if (batchTokenRef.current !== token) {
            URL.revokeObjectURL(objectUrl)
            return
          }

          const pageId = `${Date.now()}-${i}`
          // 先把当前图预览摆出来（即便多图排队也能实时看见正在识别哪一张）
          const pendingPage: OcrPageResult = { id: pageId, objectUrl, width: px.width, height: px.height, lines: [] }
          setPages((prev) => {
            const next = [...prev, pendingPage]
            setActivePageIdx(next.length - 1)
            return next
          })

          try {
            const recognized = await recognizePixelsOnSharedWorker(px, setProgress, controller.signal)
            if (batchTokenRef.current !== token) return

            totalNewLines += recognized.length
            setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, lines: recognized } : p)))

            const formatted = formatOcrLines(recognized, formatModeRef.current)
            if (formatted) {
              setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${formatted}` : formatted))
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            throw err
          }
        }

        if (batchTokenRef.current !== token) return
        if (totalNewLines > 0) {
          toast(
            fileList.length > 1
              ? `已完成 ${fileList.length} 张图片识别，共 ${totalNewLines} 行文字`
              : `识别到 ${totalNewLines} 行文字`,
          )
        } else {
          toast('没有识别到文字，换一张更清晰的图再试')
        }
      } catch (e) {
        if (batchTokenRef.current !== token) return
        const msg = e instanceof Error ? e.message : '识别失败'
        setError(msg)
        toast(msg)
      } finally {
        if (batchTokenRef.current === token) {
          if (abortCtrlRef.current === controller) abortCtrlRef.current = null
          setProgress(null)
          setQueuePos(null)
        }
      }
    },
    [revokePages, toast],
  )

  // 粘贴图片识别（ref 转发最新处理函数，监听只挂一次）
  const pasteHandlerRef = useRef<(files: Blob[]) => void>(() => {})
  useEffect(() => {
    pasteHandlerRef.current = (files: Blob[]) => {
      void handleFiles(files, appendNext && pagesRef.current.length > 0)
    }
  }, [appendNext, handleFiles])
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) return
      e.preventDefault()
      pasteHandlerRef.current(imgs)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const onChangeFormatMode = (nextMode: OcrFormatMode) => {
    setFormatMode(nextMode)
    if (!pages.length) return
    const combined = pages
      .map((p) => formatOcrLines(p.lines, nextMode))
      .filter(Boolean)
      .join('\n\n')
    if (manualEditedRef.current) {
      toast('检测到手动编辑，已保留修改', {
        label: '按新排版重置',
        run: () => {
          manualEditedRef.current = false
          setText(combined)
        },
      })
      return
    }
    setText(combined)
  }

  /** 点框 / 键盘回车复制该行 */
  const onBoxClick = async (line: OcrLine, idx: number) => {
    setSelectedBoxIdx(idx)
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

  /** 存为 MD 文档（配 useAsyncButton 状态流转） */
  const doSaveDoc = async () => {
    if (!text.trim()) return
    try {
      const title = safeName(text.trim().split('\n')[0] ?? '')
      const file = new File([text], `${title}.md`, { type: 'text/markdown' })
      const { doc, duplicated } = await importDoc(file)
      toast(duplicated ? `内容已存在《${doc.title}》` : '已存入文档库')
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败')
      throw e
    }
  }

  /** 转任务：标题取前 30 字 */
  const doAddTask = async () => {
    if (!text.trim() || savingTask) return
    setSavingTask(true)
    try {
      const title = text.replace(/\s+/g, ' ').trim().slice(0, 30)
      await addTask({ title, tier: 'today', notes: text })
      toast('已转为任务')
    } catch (e) {
      toast(e instanceof Error ? e.message : '转任务失败')
    } finally {
      setSavingTask(false)
    }
  }

  const clearAll = () => {
    cancelActiveRun()
    revokePages(pagesRef.current)
    setPages([])
    setActivePageIdx(0)
    setError('')
    setText('')
    setSearchQuery('')
    setSelectedBoxIdx(null)
    setAppendNext(false)
  }

  const activePage = pages[activePageIdx] ?? pages[pages.length - 1] ?? null
  const activeLines = useMemo(() => activePage?.lines ?? [], [activePage])
  const totalLinesCount = pages.reduce((s, p) => s + p.lines.length, 0)
  const lowConfidence = activeLines.filter((l) => l.confidence < LOW_CONFIDENCE).length

  const needle = searchQuery.trim().toLowerCase()
  const matchCount = useMemo(() => {
    if (!needle) return 0
    return activeLines.filter((l) => l.text.toLowerCase().includes(needle)).length
  }, [activeLines, needle])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />

      <header className="flex items-start gap-3.5">
        <ToolIconTile icon={IconToolOcr} />
        <div className="min-w-0">
          <h1 className="hidden md:block text-[24px] font-bold tracking-[-0.02em] leading-7">本地 OCR</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            拍照 / 截图取文字，支持分栏与表格排版、多图连续识别追加，点框复制、存为文档
          </p>
        </div>
      </header>

      {/* 输入区 */}
      <section className="card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 带 capture 的 input 在安卓只会开相机，所以相册和拍照分成两个入口 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) void handleFiles(files, false)
            }}
          />
          <input
            ref={appendInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) void handleFiles(files, true)
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) void handleFiles(files, appendNext && pages.length > 0)
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} variant="primary" className="h-9 px-4" disabled={Boolean(progress)}>
            <ImagePlus size={15} /> 相册（可多选）
          </Button>
          <Button onClick={() => cameraInputRef.current?.click()} className="h-9 px-4" disabled={Boolean(progress)}>
            <Camera size={15} /> 拍照
          </Button>
          {pages.length > 0 && (
            <>
              <Button onClick={() => appendInputRef.current?.click()} variant="outline" className="h-9 px-3" disabled={Boolean(progress)}>
                <FilePlus2 size={15} /> 追加图片继续识别
              </Button>
              <button
                type="button"
                aria-pressed={appendNext}
                onClick={() => setAppendNext((v) => !v)}
                className={cn(
                  'h-9 px-3 rounded-[10px] border text-[12px] cursor-pointer transition-colors',
                  appendNext ? 'border-primary bg-primary-soft text-primary' : 'border-outline text-on-surface-2',
                )}
              >
                粘贴/拍照追加：{appendNext ? '开' : '关'}
              </button>
              <Button onClick={clearAll} variant="ghost" className="h-9 px-3">
                <X size={15} /> 清除
              </Button>
            </>
          )}
          <p className="hidden md:block text-[11.5px] text-on-surface-2 leading-relaxed">也可以直接 Ctrl+V 粘贴截图</p>
        </div>
      </section>

      <OcrProgressBar progress={progress} queuePos={queuePos} onCancel={cancelActiveRun} />

      {error && (
        <section className="card p-4 border-danger/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-danger leading-relaxed">{error}</p>
            <p className="text-[11.5px] text-on-surface-2 mt-1 leading-relaxed">
              请检查网络连接或图片是否完整，异常模型缓存会自动清理重拉。
            </p>
          </div>
          {lastInputRef.current && (
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(progress)}
              onClick={() => {
                const last = lastInputRef.current
                if (last) void handleFiles(last.files, last.append)
              }}
              className="shrink-0"
            >
              <RefreshCw size={14} /> 重试识别
            </Button>
          )}
        </section>
      )}

      {activePage ? (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* 图 + 叠加识别框 */}
          <section className="card p-3 flex flex-col gap-2.5">
            {pages.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="已识别图片列表">
                {pages.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={idx === activePageIdx}
                    onClick={() => {
                      setActivePageIdx(idx)
                      setSelectedBoxIdx(null)
                    }}
                    className={cn(
                      'shrink-0 h-7 px-2.5 rounded-[8px] border text-[11.5px] cursor-pointer transition-colors',
                      idx === activePageIdx
                        ? 'border-primary bg-primary-soft text-primary font-medium'
                        : 'border-outline bg-surface-2 text-on-surface-2',
                    )}
                  >
                    图 {idx + 1}（{p.lines.length}行）
                  </button>
                ))}
              </div>
            )}

            {activeLines.length > 0 && (
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索本图文字，高亮定位框…"
                  aria-label="搜索识别结果"
                  className="w-full h-8 rounded-[9px] border border-outline bg-surface-2 pl-8 pr-20 text-[12px] outline-none focus:border-primary/60"
                />
                {needle && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-primary font-medium tabular-nums">
                    命中 {matchCount} 处
                  </span>
                )}
              </div>
            )}

            <div className="relative rounded-[10px] overflow-hidden bg-surface-2">
              <img src={activePage.objectUrl} alt="待识别图片" className="block w-full h-auto select-none" draggable={false} />
              {activeLines.length > 0 && (
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox={`0 0 ${activePage.width} ${activePage.height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {activeLines.map((line, i) => {
                    const isLow = line.confidence < LOW_CONFIDENCE
                    const isMatch = needle ? line.text.toLowerCase().includes(needle) : false
                    const isDimmed = Boolean(needle) && !isMatch
                    const isActive = selectedBoxIdx === i
                    const stroke = isMatch ? '#10B981' : isLow ? '#EAB308' : '#2C55B8'
                    const fill = isMatch
                      ? 'rgba(16, 185, 129, 0.28)'
                      : isActive
                        ? 'rgba(44, 85, 184, 0.30)'
                        : isLow
                          ? 'rgba(250, 204, 21, 0.22)'
                          : 'rgba(44, 85, 184, 0.14)'

                    return (
                      <polygon
                        key={i}
                        points={polygonPoints(line.box)}
                        vectorEffect="non-scaling-stroke"
                        tabIndex={0}
                        role="button"
                        aria-label={`复制第 ${i + 1} 行：${line.text}`}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isMatch || isActive ? 3 : 2}
                        strokeLinejoin="round"
                        opacity={isDimmed ? 0.25 : 1}
                        className="cursor-pointer outline-none transition-[fill,opacity,stroke-width] duration-150 hover:opacity-100 focus-visible:stroke-[3]"
                        onClick={() => void onBoxClick(line, i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            void onBoxClick(line, i)
                          }
                        }}
                      >
                        <title>{line.text}</title>
                      </polygon>
                    )
                  })}
                </svg>
              )}
            </div>
            <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
              {activeLines.length > 0 ? (
                <>
                  点击或键盘聚焦识别框回车复制该行；黄色为低置信度（&lt; 0.75）建议核对
                  {lowConfidence > 0 && <span className="text-amber-600 dark:text-amber-400"> · {lowConfidence} 行偏低</span>}
                </>
              ) : (
                '识别完成后，文本框会叠加在图上'
              )}
            </p>
          </section>

          {/* 全文编辑 + 排版模式 + 出口 */}
          <section className="card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="text-[13.5px] font-semibold">识别结果</h2>
                {totalLinesCount > 0 && (
                  <span className="text-[11px] text-on-surface-2 tabular-nums">
                    {pages.length > 1 ? `${pages.length} 张 · ` : ''}{totalLinesCount} 行
                  </span>
                )}
              </div>
              <Segmented<OcrFormatMode>
                size="sm"
                ariaLabel="识别结果排版模式"
                value={formatMode}
                onChange={onChangeFormatMode}
                options={FORMAT_OPTIONS}
              />
            </div>

            <textarea
              value={text}
              onChange={(e) => {
                manualEditedRef.current = true
                setText(e.target.value)
              }}
              rows={14}
              aria-label="识别结果文本编辑器"
              placeholder={progress ? '识别中…' : '识别出的文字会出现在这里，可直接编辑'}
              className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[220px]"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => void doCopyAll()} disabled={!text.trim()} variant="outline" className="h-9 px-4">
                <Copy size={15} /> 复制全文
              </Button>
              <Button
                state={saveDocBtn.state}
                onClick={() => void saveDocBtn.run(doSaveDoc).catch(() => undefined)}
                disabled={!text.trim() || savingTask}
                variant="primary"
                className="h-9 px-4"
              >
                <FileText size={15} /> 存为 MD 文档
              </Button>
              <Button onClick={() => void doAddTask()} disabled={!text.trim() || savingTask || saveDocBtn.state === 'loading'} variant="outline" className="h-9 px-4">
                {savingTask ? <Loader2 size={15} className="animate-spin" /> : <ListTodo size={15} />} 转任务
              </Button>
            </div>
            <p className="text-[11px] text-on-surface-2 leading-relaxed">
              「智能排版」自动分栏并合并自然段折行；「Markdown 表格」对齐多列成表；「转任务」把前 30 字作标题、全文写入备注。
            </p>
          </section>
        </div>
      ) : (
        !progress &&
        !error && (
          <EmptyState
            icon={ClipboardCopy}
            title="还没有待识别的图片"
            hint="拍照、多选相册图片或直接 Ctrl+V 粘贴截图，识别框和文字会显示在这里。"
          />
        )
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        识别在本地完成，图片不上传。首次使用需下载模型（约 16MB，缓存在本机），之后离线可用。
      </p>
    </div>
  )
}
