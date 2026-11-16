import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle,
  BookmarkPlus,
  Camera,
  CameraOff,
  CheckCircle2,
  Contact,
  Copy,
  Download,
  ExternalLink,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  ScanLine,
  Wifi,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { uid } from '@/lib/id'
import { openExternal } from '@/lib/links'
import { isNative, isTauri } from '@/lib/native'
import { openSavedAction, saveBlob } from '@/lib/saveFile'
import { addTask } from '@/db/tasks'
import { db } from '@/db/db'
import { parseQrTemplate } from './qrTemplates'
import { decodeImageData, fileToImageData } from './qrScan'

function safeVcfName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '联系人'
}

/** mailto: / sms: / tel: 在网页端用临时锚点触发，避免 window.open 打开空白标签页 */
function launchScheme(uri: string): void {
  if (isTauri() || isNative()) {
    openExternal(uri)
    return
  }
  const a = document.createElement('a')
  a.href = uri
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function QrScanTab({
  visible,
  prefill,
  onSwitchToScan,
}: {
  visible: boolean
  prefill: { value: string; seq: number } | null
  onSwitchToScan: () => void
}) {
  const navigate = useNavigate()
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

  const parsed = useMemo(() => (scanResult !== null ? parseQrTemplate(scanResult) : null), [scanResult])

  const copyText = async (value: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(value)
      toast(label)
    } catch {
      toast('复制失败，请长按文本手动复制')
    }
  }

  const toTask = async (value: string) => {
    try {
      await addTask({ title: value.slice(0, 40), tier: 'today' })
      haptic('success')
      toast('已转为今日任务')
    } catch {
      toast('转任务失败')
    }
  }

  const exportVcf = async (rawVcard: string, name: string) => {
    try {
      const blob = new Blob([rawVcard], { type: 'text/vcard;charset=utf-8' })
      const where = await saveBlob(blob, `${safeVcfName(name)}.vcf`)
      toast(`已导出名片 → ${where}`, openSavedAction())
    } catch {
      toast('导出名片失败')
    }
  }

  const kindMeta = (() => {
    switch (parsed?.kind) {
      case 'url': return { badge: '网址链接', icon: ExternalLink }
      case 'wifi': return { badge: 'WiFi 配置', icon: Wifi }
      case 'vcard': return { badge: '电子名片', icon: Contact }
      case 'email': return { badge: '电子邮件', icon: Mail }
      case 'sms': return { badge: '短信快捷', icon: MessageSquare }
      default: return { badge: '识别结果', icon: CheckCircle2 }
    }
  })()
  const HeaderIcon = kindMeta.icon

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
        <p className="hidden md:block text-[11.5px] text-on-surface-2 leading-relaxed">
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

      {scanResult !== null && parsed ? (
        <section className="rounded-[12px] border border-outline bg-surface-2 p-3.5 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
              <HeaderIcon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-primary">{kindMeta.badge}</p>

              {parsed.kind === 'wifi' && (
                <div className="mt-1.5 flex flex-col gap-1.5 text-[13px]">
                  <div className="flex items-center justify-between gap-2 rounded-[8px] bg-surface px-2.5 py-1.5 border border-outline/60">
                    <div className="min-w-0">
                      <span className="text-[11px] text-on-surface-2 block">网络名称（SSID）</span>
                      <span className="font-medium break-all select-text">{parsed.fields.ssid || '（空）'}</span>
                    </div>
                    {parsed.fields.ssid && (
                      <Button variant="outline" size="sm" onClick={() => void copyText(parsed.fields.ssid, '已复制 WiFi 名称')}>
                        <Copy size={13} /> 复制名称
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-[8px] bg-surface px-2.5 py-1.5 border border-outline/60">
                    <div className="min-w-0">
                      <span className="text-[11px] text-on-surface-2 block">
                        密码（{parsed.fields.encryption === 'nopass' ? '无密码' : parsed.fields.encryption}）
                      </span>
                      <span className="font-mono break-all select-text">
                        {parsed.fields.encryption === 'nopass' ? '无需密码' : (parsed.fields.password || '（未提供）')}
                      </span>
                    </div>
                    {parsed.fields.password && parsed.fields.encryption !== 'nopass' && (
                      <Button variant="primary" size="sm" onClick={() => void copyText(parsed.fields.password!, '已复制 WiFi 密码')}>
                        <Copy size={13} /> 复制密码
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {parsed.kind === 'vcard' && (
                <div className="mt-1.5 rounded-[8px] bg-surface p-2.5 border border-outline/60 flex flex-col gap-1 text-[12.5px]">
                  <p className="text-[14px] font-semibold select-text">{parsed.fields.name || '未命名联系人'}</p>
                  {(parsed.fields.title || parsed.fields.org) && (
                    <p className="text-on-surface-2 select-text">
                      {[parsed.fields.org, parsed.fields.title].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {parsed.fields.phone && <p className="select-text">电话：{parsed.fields.phone}</p>}
                  {parsed.fields.email && <p className="select-text break-all">邮箱：{parsed.fields.email}</p>}
                  {parsed.fields.url && <p className="select-text break-all">主页：{parsed.fields.url}</p>}
                  {parsed.fields.note && <p className="text-on-surface-2 whitespace-pre-wrap select-text">备注：{parsed.fields.note}</p>}
                </div>
              )}

              {parsed.kind === 'email' && (
                <div className="mt-1.5 rounded-[8px] bg-surface p-2.5 border border-outline/60 flex flex-col gap-1 text-[12.5px]">
                  <p className="select-text break-all">收件人：{parsed.fields.to || '（空）'}</p>
                  {parsed.fields.subject && <p className="select-text">主题：{parsed.fields.subject}</p>}
                  {parsed.fields.body && <p className="text-on-surface-2 whitespace-pre-wrap select-text">{parsed.fields.body}</p>}
                </div>
              )}

              {parsed.kind === 'sms' && (
                <div className="mt-1.5 rounded-[8px] bg-surface p-2.5 border border-outline/60 flex flex-col gap-1 text-[12.5px]">
                  <p className="select-text">号码：{parsed.fields.phone || '（空）'}</p>
                  {parsed.fields.message && <p className="text-on-surface-2 whitespace-pre-wrap select-text">{parsed.fields.message}</p>}
                </div>
              )}

              {(parsed.kind === 'url' || parsed.kind === 'text') && (
                <p className="text-[13.5px] leading-relaxed break-all select-text mt-0.5">{scanResult}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {parsed.kind === 'url' && (
              <>
                <Button onClick={() => openExternal(parsed.fields.url)} variant="primary" size="sm">
                  <ExternalLink size={14} /> 打开链接
                </Button>
                <Button
                  onClick={() => navigate(`/tools/article?url=${encodeURIComponent(parsed.fields.url)}`)}
                  variant="outline"
                  size="sm"
                >
                  <BookmarkPlus size={14} /> 离线抓文章
                </Button>
              </>
            )}

            {parsed.kind === 'vcard' && (
              <>
                <Button onClick={() => void exportVcf(scanResult, parsed.fields.name)} variant="primary" size="sm">
                  <Download size={14} /> 导出 .vcf
                </Button>
                {parsed.fields.phone && (
                  <Button onClick={() => launchScheme(`tel:${parsed.fields.phone}`)} variant="outline" size="sm">
                    <Phone size={14} /> 拨打电话
                  </Button>
                )}
              </>
            )}

            {parsed.kind === 'email' && (
              <Button onClick={() => launchScheme(scanResult)} variant="primary" size="sm">
                <Mail size={14} /> 唤起邮件
              </Button>
            )}

            {parsed.kind === 'sms' && (
              <Button
                onClick={() =>
                  launchScheme(
                    `sms:${parsed.fields.phone}${parsed.fields.message ? `?body=${encodeURIComponent(parsed.fields.message)}` : ''}`,
                  )
                }
                variant="primary"
                size="sm"
              >
                <MessageSquare size={14} /> 发送短信
              </Button>
            )}

            <Button onClick={() => void copyText(scanResult)} variant="outline" size="sm">
              <Copy size={14} /> {parsed.kind === 'wifi' || parsed.kind === 'vcard' ? '复制原文' : '复制'}
            </Button>

            {parsed.kind !== 'url' && (
              <Button
                onClick={() =>
                  void toTask(
                    parsed.kind === 'wifi'
                      ? `WiFi: ${parsed.fields.ssid}`
                      : parsed.kind === 'vcard'
                        ? `联系 ${parsed.fields.name}${parsed.fields.phone ? ` ${parsed.fields.phone}` : ''}`
                        : scanResult,
                  )
                }
                variant="outline"
                size="sm"
              >
                <ListTodo size={14} /> 转任务
              </Button>
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
