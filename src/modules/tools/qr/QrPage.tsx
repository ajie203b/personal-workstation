import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Contact,
  Copy,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  ScanLine,
  Trash2,
  Upload,
  Wifi,
  X,
} from 'lucide-react'
import { IconToolQr } from '@/shared/icons'
import QRCodeStyling from 'qr-code-styling'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented, type SegmentOption } from '@/shared/ui/Segmented'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { uid } from '@/lib/id'
import { openExternal } from '@/lib/links'
import { saveBlob } from '@/lib/saveFile'
import { addTask } from '@/db/tasks'
import { db, type QrHistoryRow } from '@/db/db'
import {
  QR_KIND_LABEL,
  buildEmailContent,
  buildSmsContent,
  buildUrlContent,
  buildVCardContent,
  buildWifiContent,
  isWebUrl,
  type QrKind,
} from './qrTemplates'
import {
  buildQrOptions,
  qrFileName,
  readPrimaryColor,
  renderQrBlob,
  selfCheckQr,
  shadeHex,
  qrSafeColor,
  type QrDotType,
  type QrEyeDotType,
  type QrEyeType,
  type QrStyle,
  type SelfCheckResult,
} from './qrGen'
import { decodeImageData, fileToImageData } from './qrScan'

/**
 * 二维码生成与扫码（v3.3）
 *
 * 生成：六种内容模板（文本/网址/WiFi/名片/邮件/短信）+ 样式（点型、码眼、渐变、Logo），
 * 默认码色跟随当前强调色，每次生成后用 jsQR 对渲染结果做容错自检；
 * 导出 PNG 512/1024/2048 与 SVG，复制图片不支持时回退成存文件。
 * 扫码：拍照/相册选图、页面粘贴图片、可选实时相机（拿不到权限就退回图片输入），
 * 识别优先系统 BarcodeDetector，没有再用 jsQR，全程本地完成。
 */
export function QrPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  /** 生成 / 扫码 两个页签（预览重建依赖它，声明放在最前） */
  const [tab, setTab] = useState<'generate' | 'scan'>('generate')

  /* ---------------- 生成：内容表单 ---------------- */

  const [kind, setKind] = useState<QrKind>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [wifiEnc, setWifiEnc] = useState<'WPA' | 'WEP' | 'nopass'>('WPA')
  const [vcName, setVcName] = useState('')
  const [vcOrg, setVcOrg] = useState('')
  const [vcTitle, setVcTitle] = useState('')
  const [vcPhone, setVcPhone] = useState('')
  const [vcEmail, setVcEmail] = useState('')
  const [vcUrl, setVcUrl] = useState('')
  const [vcNote, setVcNote] = useState('')
  const [emTo, setEmTo] = useState('')
  const [emSubject, setEmSubject] = useState('')
  const [emBody, setEmBody] = useState('')
  const [smsPhone, setSmsPhone] = useState('')
  const [smsMessage, setSmsMessage] = useState('')

  /** 表单 → 最终二维码内容（空内容表示还不完整，不生成） */
  const content = useMemo(() => {
    switch (kind) {
      case 'text':
        return text.trim() ? text : ''
      case 'url':
        return buildUrlContent(url)
      case 'wifi':
        return wifiSsid.trim()
          ? buildWifiContent({ ssid: wifiSsid.trim(), password: wifiPass, encryption: wifiEnc })
          : ''
      case 'vcard':
        return vcName.trim()
          ? buildVCardContent({
              name: vcName.trim(),
              org: vcOrg.trim(),
              title: vcTitle.trim(),
              phone: vcPhone.trim(),
              email: vcEmail.trim(),
              url: vcUrl.trim(),
              note: vcNote.trim(),
            })
          : ''
      case 'email':
        return emTo.trim()
          ? buildEmailContent({ to: emTo, subject: emSubject.trim(), body: emBody })
          : ''
      case 'sms':
        return smsPhone.trim() ? buildSmsContent({ phone: smsPhone, message: smsMessage }) : ''
    }
  }, [kind, text, url, wifiSsid, wifiPass, wifiEnc, vcName, vcOrg, vcTitle, vcPhone, vcEmail, vcUrl, vcNote, emTo, emSubject, emBody, smsPhone, smsMessage])

  /* ---------------- 生成：样式 ---------------- */

  // 颜色空字符串 = 跟随当前强调色（读 --primary）；渲染层会把浅色压暗到可扫亮度
  const [style, setStyle] = useState<QrStyle>({
    dotType: 'rounded',
    eyeType: 'extra-rounded',
    eyeDotType: 'dot',
    gradient: false,
    color: '',
    gradientColor: '',
    logo: null,
  })
  const patchStyle = (patch: Partial<QrStyle>) => setStyle((s) => ({ ...s, ...patch }))

  // 挂载时读一次强调色作为颜色控件的默认显示值
  const [defaultColor] = useState(() => qrSafeColor(readPrimaryColor()))
  const shownColor = style.color || defaultColor
  const shownGradientColor = style.gradientColor || shadeHex(defaultColor, 0.22)

  /* ---------------- 生成：预览 + 自检 + 历史 ---------------- */

  const PREVIEW_SIZE = 260
  const previewRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)
  const [selfCheck, setSelfCheck] = useState<SelfCheckResult | 'checking' | null>(null)
  const [exporting, setExporting] = useState(false)

  /** 记生成历史：内容与上一条重复就不再记，避免边打字边刷屏 */
  const logGenerate = async (data: string, dataKind: QrKind) => {
    try {
      const latest = await db.qrHistory
        .orderBy('createdAt')
        .reverse()
        .filter((r) => r.action === 'generate')
        .first()
      if (latest?.content === data) return
      await db.qrHistory.add({ id: uid(), action: 'generate', content: data, kind: dataKind, createdAt: Date.now() })
    } catch {
      // 历史写失败不打扰生成主流程
    }
  }

  useEffect(() => {
    const seq = ++seqRef.current
    const container = previewRef.current
    // 预览面板不在（切到扫码页）就不动；tab 也在依赖里，切回来会重新生成
    if (!container) return
    if (!content) {
      container.innerHTML = ''
      setSelfCheck(null)
      return
    }
    setSelfCheck('checking')
    const timer = window.setTimeout(() => {
      void (async () => {
        const options = buildQrOptions(content, style, PREVIEW_SIZE)
        container.innerHTML = ''
        new QRCodeStyling(options).append(container)
        // 生成后画到 canvas 用 jsQR 自检：Logo/样式把码压到扫不出时明确提示
        const check = await selfCheckQr(options, content)
        if (seqRef.current !== seq) return
        setSelfCheck(check)
        void logGenerate(content, kind)
      })()
    }, 320)
    return () => window.clearTimeout(timer)
    // style 为对象，每次 setStyle 都重渲染预览（logo/色/点型都是有意触发）
  }, [content, kind, style, tab])

  /* ---------------- 生成：导出 ---------------- */

  const exportImage = async (ext: 'png' | 'svg', size: number, label: string) => {
    if (!content || exporting) return
    setExporting(true)
    try {
      const blob = await renderQrBlob(content, style, size, ext)
      const where = await saveBlob(blob, qrFileName(ext))
      toast(`已导出 ${label} → ${where}`)
    } catch (e) {
      toast(`导出失败：${e instanceof Error ? e.message : '渲染出错'}`)
    } finally {
      setExporting(false)
    }
  }

  const copyImage = async () => {
    if (!content || exporting) return
    setExporting(true)
    try {
      const blob = await renderQrBlob(content, style, 1024, 'png')
      try {
        if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        haptic('success')
        toast('已复制图片到剪贴板')
      } catch {
        // WebView / 非安全上下文不支持写图片，回退成存文件（别让「复制」静默失败）
        const where = await saveBlob(blob, qrFileName('png'))
        toast(`当前环境不支持复制图片，已改为保存 → ${where}`)
      }
    } catch (e) {
      toast(`生成失败：${e instanceof Error ? e.message : '渲染出错'}`)
    } finally {
      setExporting(false)
    }
  }

  /* ---------------- 扫码 ---------------- */

  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanError, setScanError] = useState('')
  const [decoding, setDecoding] = useState(false)
  const [camActive, setCamActive] = useState(false)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const camTimerRef = useRef(0)

  /** 识别成功：展示 + 记一条扫码历史 */
  const onDecoded = (raw: string) => {
    haptic('success')
    setTab('scan')
    setScanResult(raw)
    setScanError('')
    void db.qrHistory
      .add({ id: uid(), action: 'scan', content: raw, createdAt: Date.now() })
      .catch(() => {})
    toast('识别成功')
  }

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

  const stopCamera = () => {
    if (camTimerRef.current) {
      window.clearTimeout(camTimerRef.current)
      camTimerRef.current = 0
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamActive(false)
  }

  // 卸载时一定要停相机，否则安卓上摄像头灯常亮
  useEffect(() => () => stopCamera(), [])

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

  /* ---------------- 历史 ---------------- */

  const history = useLiveQuery(() => db.qrHistory.orderBy('createdAt').reverse().limit(12).toArray(), []) ?? []

  const fillFromHistory = (row: QrHistoryRow) => {
    if (row.action === 'scan') {
      setTab('scan')
      setScanResult(row.content)
      setScanError('')
      return
    }
    // 生成记录回填进文本框——内容串不变，重新生成的就是同一张码
    setTab('generate')
    setKind('text')
    setText(row.content)
  }

  const removeHistory = (id: string) => {
    void db.qrHistory.delete(id).catch(() => {})
  }

  /* ---------------- 渲染 ---------------- */

  const kindOptions: SegmentOption<QrKind>[] = [
    { value: 'text', label: '文本', icon: FileText },
    { value: 'url', label: '网址', icon: LinkIcon },
    { value: 'wifi', label: 'WiFi', icon: Wifi },
    { value: 'vcard', label: '名片', icon: Contact },
    { value: 'email', label: '邮件', icon: Mail },
    { value: 'sms', label: '短信', icon: MessageSquare },
  ]
  const dotOptions: SegmentOption<QrDotType>[] = [
    { value: 'square', label: '方块' },
    { value: 'dots', label: '圆点' },
    { value: 'rounded', label: '圆角' },
  ]
  const eyeOptions: SegmentOption<QrEyeType>[] = [
    { value: 'square', label: '方形' },
    { value: 'extra-rounded', label: '圆角' },
    { value: 'dot', label: '圆点' },
  ]
  const eyeDotOptions: SegmentOption<QrEyeDotType>[] = [
    { value: 'dot', label: '圆点' },
    { value: 'square', label: '方块' },
  ]
  const tabOptions: SegmentOption<'generate' | 'scan'>[] = [
    { value: 'generate', label: '生成', icon: IconToolQr },
    { value: 'scan', label: '扫码', icon: ScanLine },
  ]

  const inputCls =
    'w-full h-10 px-3 rounded-[10px] bg-surface border border-outline text-[13.5px] outline-none focus:border-primary/60 placeholder:text-on-surface-2/70'
  const areaCls =
    'w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[80px]'

  return (
    <div className="mx-auto w-full max-w-4xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolQr size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">二维码</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            生成二维码、扫码识别：文本 / 网址 / WiFi / 名片，导出 PNG / SVG
          </p>
        </div>
      </header>

      <Segmented
        options={tabOptions}
        value={tab}
        onChange={setTab}
        size="sm"
        ariaLabel="生成或扫码"
        className="w-fit"
      />

      {tab === 'generate' ? (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            {/* 内容 + 样式 */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              <section className="card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-[13.5px] font-semibold">内容</h2>
                  <span className="text-[11px] text-on-surface-2">
                    {content ? `${content.length} 字` : '填好必填项后生成'}
                  </span>
                </div>
                <Segmented
                  options={kindOptions}
                  value={kind}
                  onChange={setKind}
                  size="sm"
                  ariaLabel="内容模板"
                  className="w-fit max-w-full overflow-x-auto"
                />

                {kind === 'text' && (
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    placeholder={'要编码的文本，例如：\n会议在 3 号楼 201，14:00 开始'}
                    className={areaCls}
                  />
                )}

                {kind === 'url' && (
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com（不写协议会自动补 https://）"
                    className={inputCls}
                  />
                )}

                {kind === 'wifi' && (
                  <div className="flex flex-col gap-2.5">
                    <input
                      value={wifiSsid}
                      onChange={(e) => setWifiSsid(e.target.value)}
                      placeholder="WiFi 名称（SSID）"
                      className={inputCls}
                    />
                    <div className="flex gap-2.5">
                      <input
                        value={wifiPass}
                        onChange={(e) => setWifiPass(e.target.value)}
                        placeholder={wifiEnc === 'nopass' ? '无密码' : '密码'}
                        disabled={wifiEnc === 'nopass'}
                        type={wifiEnc === 'nopass' ? 'text' : 'password'}
                        className={cn(inputCls, 'flex-1 min-w-0', wifiEnc === 'nopass' && 'opacity-50')}
                      />
                      <SelectMenu
                        value={wifiEnc}
                        onChange={(v) => setWifiEnc(v as 'WPA' | 'WEP' | 'nopass')}
                        options={[
                          { value: 'WPA', label: 'WPA/WPA2' },
                          { value: 'WEP', label: 'WEP' },
                          { value: 'nopass', label: '无密码' },
                        ]}
                        ariaLabel="WiFi 加密方式"
                        title="WiFi 加密方式"
                        triggerClassName="h-10 w-[112px] shrink-0 px-3 text-[13px]"
                      />
                    </div>
                    <p className="text-[11px] text-on-surface-2 leading-relaxed">
                      扫码后手机可直接加入该 WiFi；特殊字符会自动转义。
                    </p>
                  </div>
                )}

                {kind === 'vcard' && (
                  <div className="flex flex-col gap-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input value={vcName} onChange={(e) => setVcName(e.target.value)} placeholder="姓名（必填）" className={inputCls} />
                      <input value={vcOrg} onChange={(e) => setVcOrg(e.target.value)} placeholder="组织" className={inputCls} />
                      <input value={vcTitle} onChange={(e) => setVcTitle(e.target.value)} placeholder="职位" className={inputCls} />
                      <input value={vcPhone} onChange={(e) => setVcPhone(e.target.value)} placeholder="电话" className={inputCls} />
                      <input value={vcEmail} onChange={(e) => setVcEmail(e.target.value)} placeholder="邮箱" className={inputCls} />
                      <input value={vcUrl} onChange={(e) => setVcUrl(e.target.value)} placeholder="个人主页" className={inputCls} />
                    </div>
                    <textarea
                      value={vcNote}
                      onChange={(e) => setVcNote(e.target.value)}
                      rows={2}
                      placeholder="备注（可选）"
                      className={areaCls}
                    />
                    <p className="text-[11px] text-on-surface-2 leading-relaxed">vCard 3.0 格式，扫码后可直接存入通讯录。</p>
                  </div>
                )}

                {kind === 'email' && (
                  <div className="flex flex-col gap-2.5">
                    <input value={emTo} onChange={(e) => setEmTo(e.target.value)} placeholder="收件人（必填）" className={inputCls} />
                    <input value={emSubject} onChange={(e) => setEmSubject(e.target.value)} placeholder="主题（可选）" className={inputCls} />
                    <textarea value={emBody} onChange={(e) => setEmBody(e.target.value)} rows={3} placeholder="正文（可选）" className={areaCls} />
                  </div>
                )}

                {kind === 'sms' && (
                  <div className="flex flex-col gap-2.5">
                    <input value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)} placeholder="手机号（必填）" className={inputCls} />
                    <textarea value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)} rows={3} placeholder="短信内容（可选）" className={areaCls} />
                  </div>
                )}
              </section>

              <section className="card p-4 flex flex-col gap-3">
                <h2 className="text-[13.5px] font-semibold">样式</h2>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-[12px] text-on-surface-2 shrink-0">点型</span>
                  <Segmented options={dotOptions} value={style.dotType} onChange={(v) => patchStyle({ dotType: v })} size="sm" ariaLabel="点型" />
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-[12px] text-on-surface-2 shrink-0">码眼</span>
                  <Segmented options={eyeOptions} value={style.eyeType} onChange={(v) => patchStyle({ eyeType: v })} size="sm" ariaLabel="码眼" />
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-[12px] text-on-surface-2 shrink-0">码眼中心</span>
                  <Segmented options={eyeDotOptions} value={style.eyeDotType} onChange={(v) => patchStyle({ eyeDotType: v })} size="sm" ariaLabel="码眼中心" />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] text-on-surface-2">渐变</p>
                    <p className="text-[11px] text-on-surface-2/80 mt-0.5">主色 → 亮一档的同色系</p>
                  </div>
                  <JellySwitch checked={style.gradient} onChange={() => patchStyle({ gradient: !style.gradient })} label="渐变" />
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-[12px] text-on-surface-2">
                    码色
                    <input
                      type="color"
                      value={shownColor}
                      onChange={(e) => patchStyle({ color: e.target.value })}
                      className="w-9 h-9 rounded-[10px] border border-outline bg-surface cursor-pointer p-0.5"
                      aria-label="码色"
                    />
                  </label>
                  {style.gradient && (
                    <label className="flex items-center gap-2 text-[12px] text-on-surface-2">
                      渐变色
                      <input
                        type="color"
                        value={shownGradientColor}
                        onChange={(e) => patchStyle({ gradientColor: e.target.value })}
                        className="w-9 h-9 rounded-[10px] border border-outline bg-surface cursor-pointer p-0.5"
                        aria-label="渐变色"
                      />
                    </label>
                  )}
                  {!style.color && <span className="text-[11px] text-on-surface-2">默认跟随强调色</span>}
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      const reader = new FileReader()
                      reader.onload = () =>
                        patchStyle({ logo: typeof reader.result === 'string' ? reader.result : null })
                      reader.onerror = () => toast('Logo 读取失败')
                      reader.readAsDataURL(f)
                    }}
                  />
                  <Button onClick={() => logoInputRef.current?.click()} variant="outline" size="sm">
                    <Upload size={14} /> 上传 Logo
                  </Button>
                  {style.logo ? (
                    <span className="inline-flex items-center gap-2">
                      <img src={style.logo} alt="Logo 预览" className="w-9 h-9 rounded-[8px] object-cover border border-outline" />
                      <Button onClick={() => patchStyle({ logo: null })} variant="ghost" size="sm">
                        <X size={14} /> 移除
                      </Button>
                    </span>
                  ) : (
                    <span className="text-[11px] text-on-surface-2">中间 Logo 可选；加 Logo 会强制最高容错</span>
                  )}
                </div>
              </section>
            </div>

            {/* 预览 + 导出 */}
            <div className="flex flex-col gap-3 md:w-[292px] shrink-0">
              <section className="card p-4 flex flex-col items-center gap-3">
                <div className="rounded-[14px] bg-white border border-outline p-2.5">
                  {/* 预览容器自己不放 React 子节点：二维码是命令式 append 的，
                      占位文案放兄弟层叠在上面，避免 innerHTML 清空和 React 协调打架 */}
                  <div
                    className="relative grid place-items-center"
                    style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
                  >
                    <div
                      ref={previewRef}
                      className="grid place-items-center"
                      style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
                    />
                    {!content && (
                      <p className="absolute text-[12px] text-on-surface-2 text-center px-4">
                        填好左侧内容后
                        <br />
                        这里生成二维码
                      </p>
                    )}
                  </div>
                </div>

                {selfCheck === 'checking' && (
                  <p className="text-[11.5px] text-on-surface-2 inline-flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" /> 自检中：模拟扫码验证可读性…
                  </p>
                )}
                {selfCheck === 'ok' && (
                  <p className="text-[11.5px] text-ok inline-flex items-center gap-1.5">
                    <CheckCircle2 size={13} /> 自检通过：当前样式可以被正常识别
                  </p>
                )}
                {selfCheck === 'unreadable' && (
                  <p className="text-[11.5px] text-danger inline-flex items-center gap-1.5 leading-relaxed">
                    <AlertTriangle size={13} className="shrink-0" />
                    自检未通过：这张码扫不出来。建议换「方块」点型、加深码色或缩小 Logo。
                  </p>
                )}
                {selfCheck === 'mismatch' && (
                  <p className="text-[11.5px] text-danger inline-flex items-center gap-1.5 leading-relaxed">
                    <AlertTriangle size={13} className="shrink-0" />
                    自检异常：扫出的内容与原文不一致，Logo 可能遮挡过多，建议缩小 Logo。
                  </p>
                )}
              </section>

              <section className="card p-4 flex flex-col gap-2.5">
                <h2 className="text-[13.5px] font-semibold">导出</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void exportImage('png', 512, 'PNG 512')}
                    disabled={!content || exporting}
                    variant="outline"
                    size="sm"
                  >
                    PNG 512
                  </Button>
                  <Button
                    onClick={() => void exportImage('png', 1024, 'PNG 1024')}
                    disabled={!content || exporting}
                    variant="outline"
                    size="sm"
                  >
                    PNG 1024
                  </Button>
                  <Button
                    onClick={() => void exportImage('png', 2048, 'PNG 2048')}
                    disabled={!content || exporting}
                    variant="outline"
                    size="sm"
                  >
                    PNG 2048
                  </Button>
                  <Button
                    onClick={() => void exportImage('svg', 1024, 'SVG')}
                    disabled={!content || exporting}
                    variant="outline"
                    size="sm"
                  >
                    SVG
                  </Button>
                  <Button onClick={() => void copyImage()} disabled={!content || exporting} size="sm">
                    <Copy size={14} /> 复制图片
                  </Button>
                </div>
                <p className="text-[11px] text-on-surface-2 leading-relaxed">
                  复制图片走系统剪贴板；环境不支持时自动改成保存文件。
                </p>
              </section>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* 扫码 */}
          <section className="card p-4 flex flex-col gap-3">
            <h2 className="text-[13.5px] font-semibold">识别图片中的二维码</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={scanInputRef}
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
              <Button onClick={() => scanInputRef.current?.click()} variant="primary" disabled={decoding} className="h-9 px-4">
                {decoding ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />} 拍照 / 相册
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
        </>
      )}

      {/* 历史：生成与扫码都记，点条目回填 */}
      <section className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13.5px] font-semibold">历史</h2>
          <span className="text-[11.5px] text-on-surface-2 tabular-nums">最近 {history.length} 条</span>
        </div>
        {history.length === 0 ? (
          <p className="text-[12px] text-on-surface-2 mt-2 leading-relaxed">
            生成和扫码都会记在这里（只存本机），点条目可以回填复用。
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col divide-y divide-outline">
            {history.map((row) => (
              <li key={row.id} className="flex items-center gap-1.5 py-1.5">
                <button
                  type="button"
                  onClick={() => fillFromHistory(row)}
                  className="min-w-0 flex-1 text-left rounded-[8px] px-1.5 py-1 hover:bg-surface-2 transition-colors cursor-pointer"
                  title="回填内容"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[10.5px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                        row.action === 'generate' ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-on-surface-2',
                      )}
                    >
                      {row.action === 'generate' ? `生成·${QR_KIND_LABEL[row.kind ?? 'text']}` : '扫码'}
                    </span>
                    <p className="text-[12.5px] leading-5 truncate min-w-0">{row.content}</p>
                  </div>
                  <p className="text-[11px] text-on-surface-2 tabular-nums mt-0.5">
                    {new Date(row.createdAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </button>
                <Button
                  onClick={() => removeHistory(row.id)}
                  variant="ghost"
                  size="icon"
                  aria-label="删除这条历史"
                  title="删除"
                  className="shrink-0"
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        生成与识别都在本地完成，内容不上传。
      </p>
    </div>
  )
}
