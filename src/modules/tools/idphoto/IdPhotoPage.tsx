import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Camera,
  Download,
  FileImage,
  Image as ImageIcon,
  Loader2,
  Lock,
  Printer,
  Scissors,
  Sparkles,
} from 'lucide-react'
import { IconToolIdPhoto } from '@/shared/icons'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { saveBlob } from '@/lib/saveFile'
import {
  BUILTIN_SPECS,
  loadCustomSpecs,
  parseSpecsJson,
  saveCustomSpecs,
  serializeSpecs,
  type PhotoSpec,
} from './idphotoSpec'
import {
  computeCropBox,
  cropGuides,
  fallbackCropBox,
  type CropBox,
  type FacePoints,
} from './idphotoCrop'
import { detectFacePoints, runMatting, type MattingResult, type RgbaImage } from './idphotoEngine'
import { applyJpegDpi, canvasJpegEncoder, compressJpegToKb } from './idphotoCompress'
import {
  canvasToJpegBytes,
  composePhotoCanvas,
  composeSheetCanvas,
  composeSheetPdf,
  photoFilename,
} from './idphotoCompose'

/** 工作图最长边：定位/抠图都用它，原图再大也不进内存太久 */
const WORK_MAX_EDGE = 1600

/** 底色预设（报名照常用） */
const BG_PRESETS = [
  { id: 'white', label: '白底', value: '#FFFFFF' },
  { id: 'blue', label: '蓝底', value: '#438EDB' },
  { id: 'red', label: '红底', value: '#D9001B' },
] as const

type FaceState = 'idle' | 'running' | 'found' | 'none' | 'error'

/**
 * 证件照 / 报名照（v3.3）：选图 → 人脸定位 → 抠图 → 换底 → 按规格裁剪压 KB → 导出/排版。
 * 全程本地处理（模型只下载一次进 Cache Storage），**照片不上传**。
 */
export function IdPhotoPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const [image, setImage] = useState<RgbaImage | null>(null)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(0)

  const [faceState, setFaceState] = useState<FaceState>('idle')
  const [faceMsg, setFaceMsg] = useState('')
  const [points, setPoints] = useState<FacePoints | null>(null)
  const [adjust, setAdjust] = useState({ offsetX: 0, offsetY: 0, zoom: 1 })

  const [matte, setMatte] = useState<MattingResult | null>(null)
  const [mattingNote, setMattingNote] = useState('')

  const [bg, setBg] = useState('#FFFFFF')
  const [customBg, setCustomBg] = useState('#438EDB')

  const [specId, setSpecId] = useState('yicun')
  const [customSpecs, setCustomSpecs] = useState<PhotoSpec[]>([])
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')

  const [result, setResult] = useState<{ url: string; blob: Blob; kb: number } | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const faceCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  const allSpecs = useMemo(() => [...BUILTIN_SPECS, ...customSpecs], [customSpecs])
  const spec = allSpecs.find((s) => s.id === specId) ?? BUILTIN_SPECS[0]

  // 打开页面读一次自定义规格
  useEffect(() => {
    setCustomSpecs(loadCustomSpecs())
  }, [])

  const crop: CropBox | null = useMemo(() => {
    if (!image) return null
    const aspect = spec.width / spec.height
    if (points) {
      return computeCropBox(points, image.width, image.height, aspect, {
        headRatio: spec.headRatio,
        headroom: spec.headroom,
        offsetX: adjust.offsetX,
        offsetY: adjust.offsetY,
        zoom: adjust.zoom,
      })
    }
    return fallbackCropBox(image.width, image.height, aspect)
  }, [image, points, spec, adjust])

  // ---------- 选图 ----------

  const onPickFile = async (file: File | undefined | null) => {
    if (!file || busy) return
    setBusy('读取照片')
    try {
      // EXIF 方向靠 createImageBitmap 转正，再缩到最长边 1600
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      const scale = Math.min(1, WORK_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布创建失败')
      ctx.drawImage(bitmap, 0, 0, w, h)
      bitmap.close?.()
      const data = ctx.getImageData(0, 0, w, h).data

      setImage({ data, width: w, height: h })
      setMatte(null)
      setMattingNote('')
      setResult(null)
      setAdjust({ offsetX: 0, offsetY: 0, zoom: 1 })
      setFaceState('running')
      setFaceMsg('正在定位人脸…')
      setBusy('')

      // 人脸定位失败不拦路：退回手动框
      try {
        const pts = await detectFacePoints({ data, width: w, height: h })
        if (pts) {
          setPoints(pts)
          setFaceState('found')
          setFaceMsg('已按人脸自动取景，可用滑杆微调')
        } else {
          setPoints(null)
          setFaceState('none')
          setFaceMsg('没检测到人脸，已按画面居中取景，可用滑杆手动对位')
        }
      } catch (e) {
        setPoints(null)
        setFaceState('error')
        setFaceMsg(e instanceof Error ? e.message : '人脸模型加载失败，可手动取景')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '这张图读不出来，换一张试试')
    } finally {
      setBusy('')
    }
  }

  // ---------- 抠图 ----------

  const doMatting = async () => {
    if (!image || busy) return
    setBusy('抠图中')
    setProgress(0)
    setMattingNote('')
    try {
      const res = await runMatting(image, (r) => setProgress(Math.round(Math.max(0, r) * 100)))
      setMatte(res)
      setResult(null)
      if (res.engine === 'selfie-segmenter') {
        setMattingNote('精细抠图模型没拉下来，已用降级分割（边缘较粗），换个网络再试效果更好')
      }
      toast('抠图完成')
    } catch (e) {
      toast(e instanceof Error ? e.message : '抠图失败')
    } finally {
      setBusy('')
      setProgress(0)
    }
  }

  // ---------- 生成（裁剪 + 换底 + 压 KB） ----------

  const doGenerate = async () => {
    if (!image || !crop || busy) return
    setBusy('生成中')
    try {
      const photo = composePhotoCanvas(
        {
          cleaned: matte?.cleaned ?? image.data,
          alpha: matte?.alpha ?? new Float32Array(image.width * image.height).fill(1),
          width: image.width,
          height: image.height,
          crop,
          bg,
        },
        spec,
      )

      let blob: Blob
      if (spec.format === 'png') {
        blob = await new Promise<Blob>((resolve, reject) =>
          photo.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png'),
        )
      } else {
        // 二分压到 [minKb, maxKb]，再写 300dpi 的 JFIF 头（canvas 重编码已自然去 EXIF）
        const squeezed = await compressJpegToKb(canvasJpegEncoder(photo), {
          minKb: spec.minKb,
          maxKb: spec.maxKb,
          width: spec.width,
          height: spec.height,
        })
        blob = await applyJpegDpi(squeezed.blob, spec.dpi)
      }
      const url = URL.createObjectURL(blob)
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return { url, blob, kb: Math.round(blob.size / 102.4) / 10 }
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy('')
    }
  }

  // ---------- 导出 ----------

  const buildPhoto = (): HTMLCanvasElement => {
    if (!image || !crop) throw new Error('先选图')
    return composePhotoCanvas(
      {
        cleaned: matte?.cleaned ?? image.data,
        alpha: matte?.alpha ?? new Float32Array(image.width * image.height).fill(1),
        width: image.width,
        height: image.height,
        crop,
        bg,
      },
      spec,
    )
  }

  const exportPhoto = async () => {
    if (!result) return
    try {
      const where = await saveBlob(result.blob, photoFilename(spec, spec.format === 'png' ? 'png' : 'jpg'))
      toast(`证件照已保存 → ${where}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败')
    }
  }

  const exportSheet = async (asPdf: boolean) => {
    if (busy) return
    setBusy(asPdf ? '导出 PDF' : '导出排版')
    try {
      const photo = buildPhoto()
      const sheet = composeSheetCanvas(photo, spec)
      const jpg = await canvasToJpegBytes(sheet, 0.92)
      if (asPdf) {
        const pdf = await composeSheetPdf(jpg)
        const where = await saveBlob(new Blob([pdf], { type: 'application/pdf' }), `证件照排版_${spec.name}.pdf`)
        toast(`排版 PDF 已保存 → ${where}`)
      } else {
        const withDpi = await applyJpegDpi(new Blob([jpg], { type: 'image/jpeg' }), 300)
        const where = await saveBlob(withDpi, `证件照排版_${spec.name}_6寸.jpg`)
        toast(`排版照片已保存 → ${where}`)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败')
    } finally {
      setBusy('')
    }
  }

  // ---------- 规格 JSON / 我的规格 ----------

  const openJson = () => {
    setJsonText(serializeSpecs(customSpecs.length ? customSpecs : BUILTIN_SPECS))
    setJsonOpen((v) => !v)
  }

  const saveJson = () => {
    const parsed = parseSpecsJson(jsonText)
    if (!parsed.ok) {
      toast(parsed.error)
      return
    }
    const saved = saveCustomSpecs(parsed.specs)
    if (!saved.ok) {
      toast(saved.error)
      return
    }
    setCustomSpecs(saved.specs)
    setSpecId(saved.specs[0]?.id ?? 'yicun')
    toast(`已保存 ${saved.specs.length} 条我的规格`)
  }

  const saveCurrentAsMine = () => {
    const mine: PhotoSpec = {
      ...spec,
      id: `mine-${Date.now().toString(36)}`,
      name: `${spec.name}·自定义`,
    }
    const saved = saveCustomSpecs([...customSpecs, mine])
    if (!saved.ok) {
      toast(saved.error)
      return
    }
    setCustomSpecs(saved.specs)
    setSpecId(mine.id)
    toast(`已存为我的规格「${mine.name}」`)
  }

  // ---------- 画布重绘 ----------

  // 取景预览：原图 + 裁剪框 + 辅助线
  useEffect(() => {
    const canvas = faceCanvasRef.current
    if (!canvas || !image || !crop) return
    const scale = Math.min(1, 640 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const src = document.createElement('canvas')
    src.width = image.width
    src.height = image.height
    const sctx = src.getContext('2d')
    if (!sctx) return
    sctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

    const k = scale
    const g = cropGuides(crop)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(crop.x * k, crop.y * k, crop.width * k, crop.height * k)
    ctx.strokeStyle = 'rgba(67,142,219,0.9)'
    ctx.lineWidth = 1
    for (const y of g.thirdLinesY) {
      ctx.beginPath()
      ctx.moveTo(crop.x * k, y * k)
      ctx.lineTo((crop.x + crop.width) * k, y * k)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(217,0,27,0.9)'
    ctx.beginPath()
    ctx.moveTo(crop.x * k, g.eyeLineY * k)
    ctx.lineTo((crop.x + crop.width) * k, g.eyeLineY * k)
    ctx.stroke()
  }, [image, crop])

  // 成片预览：裁剪 + 换底 + 已抠图（未抠图时先看构图）
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !image || !crop) return
    try {
      const photo = composePhotoCanvas(
        {
          cleaned: matte?.cleaned ?? image.data,
          alpha: matte?.alpha ?? new Float32Array(image.width * image.height).fill(1),
          width: image.width,
          height: image.height,
          crop,
          bg,
        },
        spec,
      )
      canvas.width = photo.width
      canvas.height = photo.height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(photo, 0, 0)
    } catch {
      // 预览失败不影响导出
    }
  }, [image, crop, matte, bg, spec])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolIdPhoto size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">证件照 / 报名照</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            人脸取景、抠图换底、按规格裁剪压 KB、6 寸排版打印
          </p>
          <p className="inline-flex items-center gap-1 text-[11px] text-ok mt-1 font-medium">
            <Lock size={12} /> 照片不上传，全程在本机处理
          </p>
        </div>
      </header>

      {/* 1. 选图 */}
      <section className="card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
            <Camera size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">① 选照片 / 拍照</p>
            <p className="text-[11px] text-on-surface-2">正面免冠，光线均匀；会自动按 EXIF 方向转正</p>
          </div>
          <Button onClick={() => fileRef.current?.click()} className="h-9 px-4 shrink-0" disabled={Boolean(busy)}>
            <FileImage size={15} /> {image ? '重新选' : '选照片'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        {!image && (
          <EmptyState
            icon={ImageIcon}
            title="还没有照片"
            hint="从相册选一张，或直接拍一张正面照。"
            compact
          />
        )}
      </section>

      {/* 2. 人脸取景 */}
      {image && crop && (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
              <IconToolIdPhoto size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">② 人脸取景</p>
              <p className="text-[11px] text-on-surface-2 leading-relaxed">
                {faceState === 'running' && '正在定位人脸…'}
                {faceState === 'found' && faceMsg}
                {faceState === 'none' && faceMsg}
                {faceState === 'error' && faceMsg}
                {faceState === 'idle' && '白框是裁剪范围，红线是眼睛应处的高度'}
              </p>
            </div>
            {faceState === 'running' && <Loader2 size={15} className="animate-spin text-on-surface-2" />}
          </div>

          <canvas ref={faceCanvasRef} className="w-full rounded-[12px] bg-surface-2" />

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-2">左右微调 {adjust.offsetX.toFixed(2)}</span>
              <input
                type="range"
                min={-0.3}
                max={0.3}
                step={0.01}
                value={adjust.offsetX}
                onChange={(e) => {
                  setAdjust((a) => ({ ...a, offsetX: Number(e.target.value) }))
                  setResult(null)
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-2">上下微调 {adjust.offsetY.toFixed(2)}</span>
              <input
                type="range"
                min={-0.3}
                max={0.3}
                step={0.01}
                value={adjust.offsetY}
                onChange={(e) => {
                  setAdjust((a) => ({ ...a, offsetY: Number(e.target.value) }))
                  setResult(null)
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-on-surface-2">缩放 {adjust.zoom.toFixed(2)}</span>
              <input
                type="range"
                min={0.8}
                max={1.5}
                step={0.01}
                value={adjust.zoom}
                onChange={(e) => {
                  setAdjust((a) => ({ ...a, zoom: Number(e.target.value) }))
                  setResult(null)
                }}
              />
            </label>
          </div>
          <Button
            variant="outline"
            className="h-8 px-3 text-[12px] w-fit"
            onClick={() => {
              setAdjust({ offsetX: 0, offsetY: 0, zoom: 1 })
              setResult(null)
            }}
          >
            重置微调
          </Button>
        </section>
      )}

      {/* 3. 抠图 */}
      {image && (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
              <Scissors size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">③ 抠图</p>
              <p className="text-[11px] text-on-surface-2 leading-relaxed">
                人像抠图（MODNet），发丝级边缘；首次会下载模型（约 25MB，缓存后不再下）
              </p>
            </div>
            <Button onClick={() => void doMatting()} disabled={Boolean(busy)} className="h-9 px-4 shrink-0">
              {busy === '抠图中' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {matte ? '重新抠图' : '自动抠图'}
            </Button>
          </div>
          {busy === '抠图中' && (
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
          )}
          {matte && (
            <p className="text-[11px] text-on-surface-2">
              已抠图（{matte.engine === 'modnet' ? '精细模型' : '降级分割'}）
              {mattingNote && <span className="text-warning"> · {mattingNote}</span>}
            </p>
          )}
        </section>
      )}

      {/* 4. 底色 + 规格 */}
      {image && (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
              <ImageIcon size={15} />
            </span>
            <p className="text-[13.5px] font-medium flex-1">④ 换底与规格</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setBg(p.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border text-[12.5px] transition-colors',
                  bg === p.value ? 'border-primary text-primary bg-primary-soft' : 'border-outline text-on-surface-2',
                )}
              >
                <span className="w-4 h-4 rounded-full border border-outline" style={{ background: p.value }} />
                {p.label}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-outline text-[12.5px] text-on-surface-2 cursor-pointer">
              <input
                type="color"
                value={customBg}
                onChange={(e) => {
                  setCustomBg(e.target.value)
                  setBg(e.target.value)
                }}
                className="w-5 h-5 border-0 bg-transparent p-0 cursor-pointer"
              />
              自定义
            </label>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={specId}
              onChange={(e) => {
                setSpecId(e.target.value)
                setResult(null)
              }}
              className="h-9 rounded-[10px] border border-outline bg-surface-2 px-2.5 text-[12.5px] outline-none focus:border-primary/60"
            >
              {allSpecs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.width}×{s.height}）
                </option>
              ))}
            </select>
            <Button variant="outline" className="h-9 px-3 text-[12.5px]" onClick={saveCurrentAsMine}>
              保存为我的规格
            </Button>
            <Button variant="ghost" className="h-9 px-3 text-[12.5px]" onClick={openJson}>
              {jsonOpen ? '收起 JSON' : '编辑 JSON'}
            </Button>
            <p className="text-[11px] text-on-surface-2">
              {spec.format === 'jpeg' ? `JPEG · ${spec.minKb}~${spec.maxKb}KB · ${spec.dpi}dpi` : 'PNG（不压 KB）'}
            </p>
          </div>

          {jsonOpen && (
            <div className="flex flex-col gap-2">
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed font-mono outline-none focus:border-primary/60 resize-y"
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" className="h-9 px-4" onClick={saveJson}>
                  校验并保存
                </Button>
                <p className="text-[11px] text-on-surface-2 leading-relaxed">
                  字段：name / width / height / dpi / minKb / maxKb / format(jpeg|png) / headRatio / headroom / sheetCount
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 5. 预览与导出 */}
      {image && crop && (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
              <Printer size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">⑤ 生成与导出</p>
              <p className="text-[11px] text-on-surface-2">
                {spec.name} · {spec.width}×{spec.height}px
                {result ? ` · 约 ${result.kb}KB` : ''}
              </p>
            </div>
            <Button variant="primary" onClick={() => void doGenerate()} disabled={Boolean(busy)} className="h-9 px-4 shrink-0">
              {busy === '生成中' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              生成证件照
            </Button>
          </div>

          <div className="flex justify-center">
            <canvas
              ref={previewCanvasRef}
              className="max-w-[220px] w-full h-auto rounded-[12px] border border-outline"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => void exportPhoto()} disabled={!result} className="h-9 px-4">
              <Download size={15} /> 保存证件照
            </Button>
            <Button onClick={() => void exportSheet(false)} disabled={Boolean(busy)} className="h-9 px-4">
              <Printer size={15} /> 导出 6 寸排版（{spec.sheetCount} 张）
            </Button>
            <Button onClick={() => void exportSheet(true)} disabled={Boolean(busy)} className="h-9 px-4">
              <FileImage size={15} /> 导出排版 PDF
            </Button>
          </div>
          <p className="text-[11px] text-on-surface-2 leading-relaxed">
            6 寸相纸 1800×1200 @300dpi，带裁切线；JPEG 已按 {spec.dpi}dpi 写入打印尺寸，重编码自然去掉 EXIF。
            先点「生成证件照」压到 {spec.minKb}~{spec.maxKb}KB 再保存。
          </p>
        </section>
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        本地处理说明：抠图/人脸模型首次使用时下载到本机缓存（Cache Storage），之后离线可用；
        照片本身不离开设备，不做任何上传。人脸定位失败时可手动拖动滑杆对位，不影响出图。
      </p>
    </div>
  )
}
