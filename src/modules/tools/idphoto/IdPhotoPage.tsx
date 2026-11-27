import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle,
  Download,
  FileImage,
  Loader2,
  Lock,
  Printer,
  RefreshCw,
  Scissors,
  ScanFace,
  Sparkles,
} from 'lucide-react'
import { IconToolIdPhoto } from '@/shared/icons'
import { ToolIconTile } from '@/shared/ui/ToolIconTile'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { openSavedAction, saveBlob } from '@/lib/saveFile'
import { IdPhotoPicker } from './IdPhotoPicker'
import { IdPhotoSpecSection } from './IdPhotoSpecSection'
import { CHECKERBOARD_STYLE, drawFacePreview } from './idphotoPreview'
import {
  BUILTIN_SPECS,
  loadCustomSpecs,
  type PhotoFormat,
  type PhotoSpec,
} from './idphotoSpec'
import {
  applyManualAdjust,
  computeCropBox,
  fallbackCropBox,
  levelingRotation,
  refineCropWithAlpha,
  rotateFacePoints,
  type CropBox,
  type FacePoints,
} from './idphotoCrop'
import { loadOrientedImage, rotateRgba } from './idphotoImage'
import { applyPortraitBrighten } from './idphotoAlpha'
import { detectFacePoints, runMatting, type MattingResult, type RgbaImage } from './idphotoEngine'
import { applyJpegDpi, canvasJpegEncoder, compressJpegToKb } from './idphotoCompress'
import {
  SHEET_PRESETS,
  computeSheetLayout,
  maxSheetCount,
  type SheetPresetId,
} from './idphotoLayout'
import {
  canvasToJpegBytes,
  composePhotoCanvas,
  composeSheetCanvas,
  composeSheetPdf,
  drawSheetPreview,
  photoFilename,
} from './idphotoCompose'

/** 工作图最长边：定位/抠图都用它，原图再大也不进内存太久 */
const WORK_MAX_EDGE = 1600

type FaceState = 'idle' | 'running' | 'found' | 'none' | 'error'

interface GeneratedPhoto {
  url: string
  blob: Blob
  kb: number
  width: number
  height: number
  belowMinKb: boolean
  shrunkSize: boolean
}

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
  const [hairSafe, setHairSafe] = useState(true)

  const [matte, setMatte] = useState<MattingResult | null>(null)
  const [mattingNote, setMattingNote] = useState('')
  const [mattingError, setMattingError] = useState('')
  const [brighten, setBrighten] = useState(false)

  const [bg, setBg] = useState('#FFFFFF')

  const [specId, setSpecId] = useState('yicun')
  const [customSpecs, setCustomSpecs] = useState<PhotoSpec[]>([])

  const [sheetId, setSheetId] = useState<SheetPresetId>('6in')
  const [fillSheet, setFillSheet] = useState(false)

  const [result, setResult] = useState<GeneratedPhoto | null>(null)

  const faceCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const sheetCanvasRef = useRef<HTMLCanvasElement>(null)
  const pickIdRef = useRef(0)

  const allSpecs = useMemo(() => {
    const customIds = new Set(customSpecs.map((s) => s.id))
    return [...BUILTIN_SPECS.filter((s) => !customIds.has(s.id)), ...customSpecs]
  }, [customSpecs])
  const spec = allSpecs.find((s) => s.id === specId) ?? BUILTIN_SPECS[0]
  const effectiveFormat: PhotoFormat = bg === 'transparent' ? 'png' : spec.format

  const sheetPreset = SHEET_PRESETS.find((p) => p.id === sheetId) ?? SHEET_PRESETS[0]
  const maxOnSheet = useMemo(() => maxSheetCount({ width: spec.width, height: spec.height }, sheetPreset.spec), [spec.width, spec.height, sheetPreset.spec])
  const targetSheetCount = fillSheet ? maxOnSheet : spec.sheetCount
  const placedSheetCount = useMemo(
    () => computeSheetLayout({ width: spec.width, height: spec.height }, sheetPreset.spec, targetSheetCount).cells.length,
    [spec.width, spec.height, sheetPreset.spec, targetSheetCount],
  )

  // 打开页面读一次自定义规格
  useEffect(() => {
    setCustomSpecs(loadCustomSpecs())
  }, [])

  // result.url 生命周期集中回收：切换底色、调整参数、重新生成、退出页面都不泄漏 Blob URL
  useEffect(() => {
    const url = result?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [result?.url])

  const selectBg = (nextBg: string) => {
    setBg(nextBg)
    setResult(null)
  }

  const crop: CropBox | null = useMemo(() => {
    if (!image) return null
    const aspect = spec.width / spec.height
    // 先算自动框（人脸 / 居中兜底），抠图后叠加发际安全留白，最后叠加滑杆微调
    let base = points
      ? computeCropBox(points, image.width, image.height, aspect, {
          headRatio: spec.headRatio,
          headroom: spec.headroom,
        })
      : fallbackCropBox(image.width, image.height, aspect)
    if (matte && hairSafe) {
      base = refineCropWithAlpha(base, matte.alpha, image.width, image.height, spec.headroom)
    }
    return applyManualAdjust(base, adjust, image.width, image.height)
  }, [image, points, spec, adjust, matte, hairSafe])

  const subjectPixels = useMemo(() => {
    if (!image) return null
    const raw = matte?.cleaned ?? image.data
    if (!brighten) return raw
    const mask = matte?.alpha ?? new Float32Array(image.width * image.height).fill(1)
    return applyPortraitBrighten(raw, mask, image.width, image.height)
  }, [image, matte, brighten])

  // ---------- 选图 ----------

  const onPickFile = async (file: File | undefined | null) => {
    if (!file || busy) return
    const pickId = ++pickIdRef.current
    setBusy('读取照片')
    try {
      // EXIF 方向：自己解析 Orientation 再画正（不依赖 WebView 的 imageOrientation 实现），缩到最长边 1600
      const loaded = await loadOrientedImage(file, WORK_MAX_EDGE)
      if (pickIdRef.current !== pickId) return
      let data = loaded.data
      const w = loaded.width
      const h = loaded.height

      setImage({ data, width: w, height: h })
      setPoints(null)
      setMatte(null)
      setMattingNote('')
      setMattingError('')
      setResult(null)
      setAdjust({ offsetX: 0, offsetY: 0, zoom: 1 })
      setFaceState('running')
      setFaceMsg('正在定位人脸…')
      setBusy('')

      // 人脸定位失败不拦路：退回手动框
      try {
        let pts = await detectFacePoints({ data, width: w, height: h })
        if (pickIdRef.current !== pickId) return
        let leveled = false
        if (pts) {
          // 按两眼连线自动扶正：绕两眼中点转到水平，关键点同步旋转
          const rot = levelingRotation(pts)
          if (rot !== 0) {
            const cx = (pts.leftEye.x + pts.rightEye.x) / 2
            const cy = (pts.leftEye.y + pts.rightEye.y) / 2
            const rotated = rotateRgba({ data, width: w, height: h }, rot, cx, cy)
            data = rotated.data
            pts = rotateFacePoints(pts, rot, cx, cy)
            setImage({ data, width: w, height: h })
            setMatte(null)
            setMattingError('')
            setResult(null)
            leveled = true
          }
          setPoints(pts)
          setFaceState('found')
          setFaceMsg(leveled ? '已按人脸自动取景并扶正头部，可用滑杆微调' : '已按人脸自动取景，可用滑杆微调')
        } else {
          setPoints(null)
          setFaceState('none')
          setFaceMsg('没识别到人脸，请用滑杆手动调整。')
        }
      } catch (e) {
        if (pickIdRef.current !== pickId) return
        setPoints(null)
        setFaceState('error')
        setFaceMsg(e instanceof Error ? e.message : '人脸模型加载失败，可手动取景')
      }
    } catch (e) {
      if (pickIdRef.current === pickId) {
        toast(e instanceof Error ? e.message : '这张图读不出来，换一张试试')
      }
    } finally {
      if (pickIdRef.current === pickId) setBusy('')
    }
  }

  // ---------- 抠图 ----------

  const doMatting = async () => {
    if (!image || busy || faceState === 'running') return
    setBusy('抠图中')
    setProgress(0)
    setMattingNote('')
    setMattingError('')
    try {
      const res = await runMatting(image, (r) => setProgress(Math.round(Math.max(0, r) * 100)))
      setMatte(res)
      setResult(null)
      if (res.engine === 'selfie-segmenter') {
        setMattingNote('精细抠图模型没拉下来，已用降级分割（边缘较粗），换个网络再试效果更好')
      }
      toast('抠图完成')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '抠图失败'
      setMattingError(msg)
      toast(msg)
    } finally {
      setBusy('')
      setProgress(0)
    }
  }

  // ---------- 生成（裁剪 + 换底 + 压 KB） ----------

  const buildPhoto = (): HTMLCanvasElement => {
    if (!image || !crop || !subjectPixels) throw new Error('先选图')
    return composePhotoCanvas(
      {
        cleaned: subjectPixels,
        alpha: matte?.alpha ?? new Float32Array(image.width * image.height).fill(1),
        width: image.width,
        height: image.height,
        crop,
        bg,
      },
      spec,
    )
  }

  const doGenerate = async () => {
    if (!image || !crop || busy || faceState === 'running') return
    setBusy('生成中')
    try {
      const photo = buildPhoto()

      if (effectiveFormat === 'png') {
        const blob = await new Promise<Blob>((resolve, reject) =>
          photo.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png'),
        )
        const url = URL.createObjectURL(blob)
        setResult({
          url,
          blob,
          kb: Math.round(blob.size / 102.4) / 10,
          width: spec.width,
          height: spec.height,
          belowMinKb: false,
          shrunkSize: false,
        })
      } else {
        // 二分压到 [minKb, maxKb]，再写对应 dpi 的 JFIF 头（canvas 重编码已自然去 EXIF）
        const squeezed = await compressJpegToKb(canvasJpegEncoder(photo), {
          minKb: spec.minKb,
          maxKb: spec.maxKb,
          width: spec.width,
          height: spec.height,
        })
        const blob = await applyJpegDpi(squeezed.blob, spec.dpi)
        const url = URL.createObjectURL(blob)
        setResult({
          url,
          blob,
          kb: Math.round(blob.size / 102.4) / 10,
          width: squeezed.width,
          height: squeezed.height,
          belowMinKb: blob.size < spec.minKb * 1024,
          shrunkSize: squeezed.shrunkSize,
        })
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy('')
    }
  }

  // ---------- 导出 ----------

  const exportPhoto = async () => {
    if (!result) return
    try {
      const where = await saveBlob(result.blob, photoFilename(spec, effectiveFormat === 'png' ? 'png' : 'jpg'))
      toast(`证件照已保存 → ${where}`, openSavedAction())
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败')
    }
  }

  const exportSheet = async (asPdf: boolean) => {
    if (busy || faceState === 'running') return
    setBusy(asPdf ? '导出 PDF' : '导出排版')
    try {
      const photo = buildPhoto()
      const sheet = composeSheetCanvas(photo, spec, sheetPreset.spec, targetSheetCount)
      const jpg = await canvasToJpegBytes(sheet, 0.92)
      if (asPdf) {
        const pdf = await composeSheetPdf(jpg, sheetPreset.spec)
        const where = await saveBlob(new Blob([pdf], { type: 'application/pdf' }), `证件照排版_${spec.name}_${sheetPreset.label}.pdf`)
        toast(`排版 PDF 已保存 → ${where}`, openSavedAction())
      } else {
        const withDpi = await applyJpegDpi(new Blob([jpg], { type: 'image/jpeg' }), sheetPreset.spec.dpi)
        const where = await saveBlob(withDpi, `证件照排版_${spec.name}_${sheetPreset.label}.jpg`)
        toast(`排版照片已保存 → ${where}`, openSavedAction())
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败')
    } finally {
      setBusy('')
    }
  }

  const selectSpec = (nextId: string) => {
    setSpecId(nextId)
    setResult(null)
  }

  useEffect(() => {
    const canvas = faceCanvasRef.current
    if (canvas && image && crop) drawFacePreview(canvas, image, crop)
  }, [image, crop])

  // 成片预览 + 实时排版缩略图预览
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !image || !crop || !subjectPixels) return
    try {
      const photo = composePhotoCanvas(
        {
          cleaned: subjectPixels,
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
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      ctx?.drawImage(photo, 0, 0)

      const sheetCanvas = sheetCanvasRef.current
      if (sheetCanvas) {
        drawSheetPreview(sheetCanvas, photo, spec, sheetPreset.spec, targetSheetCount)
      }
    } catch {
      // 预览失败不影响导出
    }
  }, [image, crop, subjectPixels, matte, bg, spec, sheetPreset, targetSheetCount])

  const actionLocked = Boolean(busy) || faceState === 'running'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />

      <header className="flex items-start gap-3.5">
        <ToolIconTile icon={IconToolIdPhoto} />
        <div className="min-w-0">
          <h1 className="hidden md:block text-[24px] font-bold tracking-[-0.02em] leading-7">证件照 / 报名照</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            人脸取景、抠图换底、按规格裁剪压 KB、多尺寸排版打印
          </p>
          <p className="inline-flex items-center gap-1 text-[11px] text-ok mt-1 font-medium">
            <Lock size={12} /> 照片不上传，全程在本机处理
          </p>
        </div>
      </header>

      {/* 1. 选图 */}
      <IdPhotoPicker busy={Boolean(busy)} hasImage={Boolean(image)} onPickFile={onPickFile} />

      {/* 2. 人脸取景 */}
      {image && crop && (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
              <ScanFace size={15} />
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
            {faceState === 'running' && <Loader2 size={15} className="animate-spin text-on-surface-2 shrink-0" />}
          </div>

          <canvas
            ref={faceCanvasRef}
            role="img"
            aria-label="人脸取景裁剪预览"
            className="w-full rounded-[12px] bg-surface-2"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-on-surface-2">左右微调 {adjust.offsetX.toFixed(2)}</span>
              <input
                type="range"
                aria-label="左右微调"
                min={-0.3}
                max={0.3}
                step={0.01}
                value={adjust.offsetX}
                className="reader-range"
                style={{ '--range-pct': `${((adjust.offsetX + 0.3) / 0.6) * 100}%` } as CSSProperties}
                onChange={(e) => {
                  setAdjust((a) => ({ ...a, offsetX: Number(e.target.value) }))
                  setResult(null)
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-on-surface-2">上下微调 {adjust.offsetY.toFixed(2)}</span>
              <input
                type="range"
                aria-label="上下微调"
                min={-0.3}
                max={0.3}
                step={0.01}
                value={adjust.offsetY}
                className="reader-range"
                style={{ '--range-pct': `${((adjust.offsetY + 0.3) / 0.6) * 100}%` } as CSSProperties}
                onChange={(e) => {
                  setAdjust((a) => ({ ...a, offsetY: Number(e.target.value) }))
                  setResult(null)
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-on-surface-2">缩放 {adjust.zoom.toFixed(2)}</span>
              <input
                type="range"
                aria-label="缩放"
                min={0.8}
                max={1.5}
                step={0.01}
                value={adjust.zoom}
                className="reader-range"
                style={{ '--range-pct': `${((adjust.zoom - 0.8) / 0.7) * 100}%` } as CSSProperties}
                onChange={(e) => {
                  setAdjust((a) => ({ ...a, zoom: Number(e.target.value) }))
                  setResult(null)
                }}
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
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
            {matte && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-on-surface-2">护发留白（防削发梢）</span>
                <JellySwitch
                  checked={hairSafe}
                  label="护发留白"
                  onChange={() => {
                    setHairSafe((v) => !v)
                    setResult(null)
                  }}
                />
              </div>
            )}
          </div>
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
            <Button onClick={() => void doMatting()} disabled={actionLocked} className="h-9 px-4 shrink-0">
              {busy === '抠图中' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {matte ? '重新抠图' : '自动抠图'}
            </Button>
          </div>
          {busy === '抠图中' && (
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
          )}
          {mattingError && (
            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-danger/35 bg-danger/5 px-3 py-2.5">
              <p className="text-[12px] text-danger leading-relaxed min-w-0 flex-1">{mattingError}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={actionLocked}
                onClick={() => void doMatting()}
                className="shrink-0"
              >
                <RefreshCw size={14} /> 重试抠图
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {matte ? (
              <p className="text-[11px] text-on-surface-2">
                已抠图（{matte.engine === 'modnet' ? '精细模型' : '降级分割'}）
                {mattingNote && <span className="text-amber-600 dark:text-amber-400"> · {mattingNote}</span>}
              </p>
            ) : (
              <p className="text-[11px] text-on-surface-2">
                {faceState === 'running' ? '正在定位人脸，完成后即可抠图' : '抠图后支持任意换底色、透明底及局部去白边'}
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-on-surface-2">轻度人像提亮</span>
              <JellySwitch
                checked={brighten}
                label="轻度人像提亮"
                onChange={() => {
                  setBrighten((v) => !v)
                  setResult(null)
                }}
              />
            </div>
          </div>
        </section>
      )}

      {/* 4. 底色 + 规格 */}
      {image && (
        <IdPhotoSpecSection
          spec={spec}
          allSpecs={allSpecs}
          customSpecs={customSpecs}
          bg={bg}
          effectiveFormat={effectiveFormat}
          onSelectBg={selectBg}
          onSelectSpec={selectSpec}
          onCustomSpecsChange={(specs, selectedId) => {
            setCustomSpecs(specs)
            selectSpec(selectedId)
          }}
        />
      )}

      {/* 5. 预览与导出 */}
      {image && crop && (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
              <Printer size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">⑤ 生成与导出</p>
              <p className="text-[11px] text-on-surface-2">
                {spec.name} · {result ? `${result.width}×${result.height}px` : `${spec.width}×${spec.height}px`}
                {result ? ` · 约 ${result.kb}KB` : ''}
              </p>
            </div>
            <Button variant="primary" onClick={() => void doGenerate()} disabled={actionLocked} className="h-9 px-4 shrink-0">
              {busy === '生成中' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {effectiveFormat === 'png' ? '生成透明 PNG' : '生成证件照'}
            </Button>
          </div>

          {result && (result.belowMinKb || result.shrunkSize) && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300 leading-relaxed"
            >
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                {result.shrunkSize && (
                  <span>
                    原尺寸在最低画质下仍超 {spec.maxKb}KB，已等比缩小至 {result.width}×{result.height}px 以满足上限。
                  </span>
                )}
                {result.belowMinKb && (
                  <span>
                    画质已拉到最高（100%），文件体积仍为 {result.kb}KB（低于下限 {spec.minKb}KB），常见于纯色背景照片。
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <canvas
                ref={previewCanvasRef}
                role="img"
                aria-label="证件照成片预览"
                style={bg === 'transparent' ? CHECKERBOARD_STYLE : undefined}
                className="max-w-[200px] w-full h-auto rounded-[12px] border border-outline"
              />
              <span className="text-[11px] text-on-surface-2">单张成片预览</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <canvas
                ref={sheetCanvasRef}
                role="img"
                aria-label="排版打印预览"
                className="max-w-[280px] max-h-[220px] w-auto h-auto rounded-[10px] border border-outline bg-white shadow-xs"
              />
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Segmented<SheetPresetId>
                  size="sm"
                  ariaLabel="排版相纸尺寸"
                  value={sheetId}
                  onChange={setSheetId}
                  options={SHEET_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                />
                <button
                  type="button"
                  aria-pressed={fillSheet}
                  onClick={() => setFillSheet((v) => !v)}
                  className={cn(
                    'h-7 px-2.5 rounded-[8px] border text-[11.5px] cursor-pointer transition-colors',
                    fillSheet ? 'border-primary bg-primary-soft text-primary' : 'border-outline text-on-surface-2',
                  )}
                >
                  {fillSheet ? `铺满（${placedSheetCount}张）` : `按规格（${placedSheetCount}张）`}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => void exportPhoto()} disabled={!result} className="h-9 px-4">
              <Download size={15} /> 保存{effectiveFormat === 'png' ? ' PNG' : '证件照'}
            </Button>
            <Button onClick={() => void exportSheet(false)} disabled={actionLocked} className="h-9 px-4">
              <Printer size={15} /> 导出{sheetPreset.label}排版（{placedSheetCount} 张）
            </Button>
            <Button onClick={() => void exportSheet(true)} disabled={actionLocked} className="h-9 px-4">
              <FileImage size={15} /> 导出{sheetPreset.label} PDF
            </Button>
          </div>
          <p className="text-[11px] text-on-surface-2 leading-relaxed">
            {sheetPreset.label}相纸 {sheetPreset.spec.width}×{sheetPreset.spec.height} @{sheetPreset.spec.dpi}dpi，带裁切线与浅灰边框；
            {effectiveFormat === 'png'
              ? 'PNG 保留透明背景（或无损画质），排版印制时自动铺白纸。'
              : `JPEG 已按 ${spec.dpi}dpi 写入打印尺寸，重编码自然去掉 EXIF。先点「生成证件照」压到 ${spec.minKb}~${spec.maxKb}KB 再保存。`}
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
