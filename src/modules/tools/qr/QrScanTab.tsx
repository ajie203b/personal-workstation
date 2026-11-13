import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Copy,
  ExternalLink,
  ListTodo,
  Loader2,
  ScanLine,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { uid } from '@/lib/id'
import { openExternal } from '@/lib/links'
import { addTask } from '@/db/tasks'
import { db } from '@/db/db'
import { isWebUrl } from './qrTemplates'
import { decodeImageData, fileToImageData } from './qrScan'

export function QrScanTab({
  visible,
  prefill,
  onSwitchToScan,
}: {
  visible: boolean
  prefill: { value: string; seq: number } | null
  onSwitchToScan: () => void
}) {
  const toast = useUi((s) => s.toast)

  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanError, setScanError] = useState('')
  const [decoding, setDecoding] = useState(false)
  const [camActive, setCamActive] = useState(false)

  const scanInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const camTimerRef = useRef(0)

  useEffect(() => {
    if (!prefill) return
    setScanResult(prefill.value)
    setScanError('')
  }, [prefill])

  /** 识别成功：展示 + 记一条扫码历史 */
  const onDecoded = useCallback((raw: string) => {
    haptic('success')
    onSwitchToScan()
    setScanResult(raw)
    setScanError('')
    void db.qrHistory
      .add({ id: uid(), action: 'scan', content: raw, createdAt: Date.now() })
      .catch(() => {})
    toast('识别成功')
  }, [onSwitchToScan, toast])

  /** 图片来源（相册/拍照/粘贴）统一入口 */
  const handleImageSource = async (source: Blob) => {
    setDecoding(true)
    setScanError('')
    try {
      const pixels = await fileToImageData(source)
      const hit = await decodeImageData(pixels)
      if (!hit) {
        setScanError('没有识别到二维码。换一张更清晰、码面完整的图再试。')
        toast('没有识别到二维码')
        return
      }
      onDecoded(hit)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '图片读取失败'
      setScanError(msg)
      toast(msg)
    } finally {
      setDecoding(false)
    }
  }

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

  /* ---------------- 实时扫码（可选，拿不到相机就退回图片输入） ---------------- */

  const stopCamera = useCallback(() => {
    if (camTimerRef.current) {
      window.clearTimeout(camTimerRef.current)
      camTimerRef.current = 0
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamActive(false)
  }, [])

  // 卸载时一定要停相机，否则安卓上摄像头灯常亮
  useEffect(() => () => stopCamera(), [stopCamera])

  const scheduleCamScan = () => {
    camTimerRef.current = window.setTimeout(() => void camScanOnce(), 250)
  }

  const camScanOnce = async () => {
    const video = videoRef.current
    if (!streamRef.current || !video) return
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0)
          const hit = await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
          if (hit) {
            onDecoded(hit)
            stopCamera()
            return
          }
        }
      }
    } catch {
      // 单帧解码失败不停机，继续扫下一帧
    }
    scheduleCamScan()
  }

  const startCamera = async () => {
    if (camActive) return
    const md = navigator.mediaDevices
    if (!md?.getUserMedia) {
      toast('当前环境不支持摄像头，请用拍照、相册选图或粘贴图片')
      return
    }
    try {
      const stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      setCamActive(true)
      setScanError('')
      scheduleCamScan()
    } catch {
      // 安卓 WebView 无相机权限时 getUserMedia 直接失败：退回图片输入，不白屏不卡死
      toast('无法打开相机（未授权或被占用）。可改用拍照、相册选图或粘贴图片识别')
    }
  }

  /* ---------------- 结果处置 ---------------- */

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast('已复制')
    } catch {
      toast('复制失败，请长按文本手动复制')
    }
  }

  const toTask = async (value: string) => {
    try {
      await addTask({ title: value.slice(0, 30), tier: 'today' })
      haptic('success')
      toast('已转为今日任务')
    } catch {
      toast('转任务失败')
    }
  }

  return (
    <section className={cn('card p-4 flex flex-col gap-3', !visible && 'hidden')}>
      <h2 className="text-[13.5px] font-semibold">识别图片中的二维码</h2>
      <div className="flex items-center gap-2 flex-wrap">
        {/* 不带 capture：安卓上带 capture 只开相机进不了相册；实时扫码用旁边的摄像头按钮 */}
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleImageSource(f)
          }}
        />
        <Button onClick={() => scanInputRef.current?.click()} variant="primary" disabled={decoding} className="h-9 px-4">
          {decoding ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />} 从相册选
        </Button>
        <Button
          onClick={() => (camActive ? stopCamera() : void startCamera())}
          variant="outline"
          className="h-9 px-4"
        >
          {camActive ? <CameraOff size={15} /> : <Camera size={15} />} {camActive ? '停止相机' : '实时扫码'}
        </Button>
        <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
          也可以直接 Ctrl+V 粘贴图片
        </p>
      </div>

      {/* 视频常驻渲染（隐藏时 ref 仍可用），实时扫码把帧交给识别管线 */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn('w-full rounded-[12px] bg-black aspect-[4/3] object-cover', !camActive && 'hidden')}
      />

      {scanError && (
        <div className="card p-3.5 flex items-start gap-2.5 border-danger/25">
          <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
          <p className="text-[12.5px] leading-relaxed">{scanError}</p>
        </div>
      )}

      {scanResult !== null ? (
        <section className="rounded-[12px] border border-outline bg-surface-2 p-3.5 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
              <CheckCircle2 size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-on-surface-2">识别结果</p>
              <p className="text-[13.5px] leading-relaxed break-all select-text mt-0.5">{scanResult}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isWebUrl(scanResult) ? (
              <>
                <Button onClick={() => openExternal(scanResult)} variant="primary" size="sm">
                  <ExternalLink size={14} /> 打开链接
                </Button>
                <Button onClick={() => void copyText(scanResult)} variant="outline" size="sm">
                  <Copy size={14} /> 复制
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => void copyText(scanResult)} variant="outline" size="sm">
                  <Copy size={14} /> 复制
                </Button>
                <Button onClick={() => void toTask(scanResult)} variant="outline" size="sm">
                  <ListTodo size={14} /> 转任务
                </Button>
              </>
            )}
          </div>
        </section>
      ) : (
        !decoding &&
        !camActive && (
          <EmptyState
            icon={ScanLine}
            title="还没有识别结果"
            hint="拍照、从相册选图，或在页面里粘贴图片，识别结果会显示在这里。"
            compact
          />
        )
      )}
    </section>
  )
}
