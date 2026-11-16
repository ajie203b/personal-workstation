import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Contact,
  Copy,
  FileText,
  Link as LinkIcon,
  Loader2,
  Mail,
  MessageSquare,
  ShieldAlert,
  Upload,
  Wifi,
  X,
} from 'lucide-react'
import QRCodeStyling from 'qr-code-styling'
import { Button } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented, type SegmentOption } from '@/shared/ui/Segmented'
import { HexColorInput } from '@/shared/ui/HexColorInput'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { uid } from '@/lib/id'
import { openSavedAction, saveBlob } from '@/lib/saveFile'
import { db } from '@/db/db'
import {
  buildEmailContent,
  buildSmsContent,
  buildUrlContent,
  buildVCardContent,
  buildWifiContent,
  parseQrTemplate,
  type QrKind,
} from './qrTemplates'
import {
  buildQrOptions,
  effectiveErrorCorrection,
  qrFileName,
  qrSafeColor,
  readPrimaryColor,
  renderQrBlob,
  selfCheckQr,
  shadeHex,
  type QrDotType,
  type QrErrorLevel,
  type QrEyeDotType,
  type QrEyeType,
  type QrStyle,
  type SelfCheckResult,
} from './qrGen'

const KIND_OPTIONS: SegmentOption<QrKind>[] = [
  { value: 'text', label: '文本', icon: FileText },
  { value: 'url', label: '网址', icon: LinkIcon },
  { value: 'wifi', label: 'WiFi', icon: Wifi },
  { value: 'vcard', label: '名片', icon: Contact },
  { value: 'email', label: '邮件', icon: Mail },
  { value: 'sms', label: '短信', icon: MessageSquare },
]
const DOT_OPTIONS: SegmentOption<QrDotType>[] = [
  { value: 'square', label: '方块' },
  { value: 'dots', label: '圆点' },
  { value: 'rounded', label: '圆角' },
]
const EYE_OPTIONS: SegmentOption<QrEyeType>[] = [
  { value: 'square', label: '方形' },
  { value: 'extra-rounded', label: '圆角' },
  { value: 'dot', label: '圆点' },
]
const EYE_DOT_OPTIONS: SegmentOption<QrEyeDotType>[] = [
  { value: 'dot', label: '圆点' },
  { value: 'square', label: '方块' },
]
const EC_OPTIONS: SegmentOption<QrErrorLevel>[] = [
  { value: 'M', label: 'M 15%' },
  { value: 'Q', label: 'Q 25%' },
  { value: 'H', label: 'H 30%' },
]

const INPUT_CLS =
  'w-full h-10 px-3 rounded-[10px] bg-surface border border-outline text-[13.5px] outline-none focus:border-primary/60 placeholder:text-on-surface-2/70'
const AREA_CLS =
  'w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[80px]'
const PREVIEW_SIZE = 260
const CHECKERBOARD_CLS =
  'bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%,#e5e7eb),linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%,#e5e7eb)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-white'

export function QrGenerateTab({
  visible,
  prefill,
}: {
  visible: boolean
  prefill: { value: string; kind?: QrKind; seq: number } | null
}) {
  const toast = useUi((s) => s.toast)
  const theme = useUi((s) => s.theme)
  const accent = useUi((s) => s.accent)

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

  useEffect(() => {
    if (!prefill) return
    const parsed = parseQrTemplate(prefill.value)
    // 若历史明确存为纯文本，仍允许还原结构化网址以外的文本；标准模板均还原到对应表单
    const targetKind = prefill.kind === 'text' && parsed.kind === 'url' ? 'text' : parsed.kind
    setKind(targetKind)
    if (targetKind === 'text') {
      setText(prefill.value)
      return
    }
    switch (parsed.kind) {
      case 'url':
        setUrl(parsed.fields.url)
        break
      case 'wifi':
        setWifiSsid(parsed.fields.ssid)
        setWifiPass(parsed.fields.password ?? '')
        setWifiEnc(parsed.fields.encryption ?? 'WPA')
        break
      case 'vcard':
        setVcName(parsed.fields.name)
        setVcOrg(parsed.fields.org ?? '')
        setVcTitle(parsed.fields.title ?? '')
        setVcPhone(parsed.fields.phone ?? '')
        setVcEmail(parsed.fields.email ?? '')
        setVcUrl(parsed.fields.url ?? '')
        setVcNote(parsed.fields.note ?? '')
        break
      case 'email':
        setEmTo(parsed.fields.to)
        setEmSubject(parsed.fields.subject ?? '')
        setEmBody(parsed.fields.body ?? '')
        break
      case 'sms':
        setSmsPhone(parsed.fields.phone)
        setSmsMessage(parsed.fields.message ?? '')
        break
      case 'text':
        setText(parsed.fields.text)
        break
    }
  }, [prefill])

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

  // 颜色空字符串 = 跟随当前强调色（读 --primary）；主题或强调色切换时实时同步
  const [style, setStyle] = useState<QrStyle>({
    dotType: 'rounded',
    eyeType: 'extra-rounded',
    eyeDotType: 'dot',
    errorCorrectionLevel: 'M',
    transparentBg: false,
    gradient: false,
    color: '',
    gradientColor: '',
    logo: null,
  })
  const patchStyle = (patch: Partial<QrStyle>) => setStyle((s) => ({ ...s, ...patch }))

  const [defaultColor, setDefaultColor] = useState(() => qrSafeColor(readPrimaryColor()))
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setDefaultColor(qrSafeColor(readPrimaryColor()))
    })
    return () => cancelAnimationFrame(id)
  }, [theme, accent])

  const shownColor = style.color || defaultColor
  const shownGradientColor = style.gradientColor || shadeHex(shownColor, 0.22)
  const ecForced = Boolean(style.logo) || style.dotType === 'dots'
  const effectiveEc = effectiveErrorCorrection(style)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const mobilePreviewRef = useRef<HTMLDivElement>(null)
  const exportSectionRef = useRef<HTMLElement>(null)
  const seqRef = useRef(0)
  const lastLoggedRef = useRef<string>('')
  const prevVisibleRef = useRef(visible)

  const [selfCheck, setSelfCheck] = useState<SelfCheckResult | 'checking' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [unsafeConfirmed, setUnsafeConfirmed] = useState(false)
  const [pendingExportKey, setPendingExportKey] = useState<string | null>(null)

  /** 记生成历史：导出/复制/失焦或切走标签时记录，内容与上一条重复则跳过 */
  const logGenerate = useCallback(async (data: string, dataKind: QrKind) => {
    if (!data || lastLoggedRef.current === data) return
    lastLoggedRef.current = data
    try {
      const latest = await db.qrHistory
        .orderBy('createdAt')
        .reverse()
        .filter((r) => r.action === 'generate')
        .first()
      if (latest?.content === data) return
      await db.qrHistory.add({ id: uid(), action: 'generate', content: data, kind: dataKind, createdAt: Date.now() })
    } catch {
      lastLoggedRef.current = ''
    }
  }, [])

  const onFormBlur = () => {
    if (content) void logGenerate(content, kind)
  }

  // 从「生成」切去「扫码」时补记一次当前内容，避免失焦漏记
  useEffect(() => {
    if (prevVisibleRef.current && !visible && content) {
      void logGenerate(content, kind)
    }
    prevVisibleRef.current = visible
  }, [content, kind, logGenerate, visible])

  // 内容或样式变化时重置风险二次确认状态
  useEffect(() => {
    setUnsafeConfirmed(false)
    setPendingExportKey(null)
  }, [content, style])

  useEffect(() => {
    if (!visible) return
    const seq = ++seqRef.current
    const container = previewRef.current
    const mobileContainer = mobilePreviewRef.current
    if (!container) return
    if (!content) {
      container.innerHTML = ''
      if (mobileContainer) mobileContainer.innerHTML = ''
      setSelfCheck(null)
      return
    }
    setSelfCheck('checking')
    const timer = window.setTimeout(() => {
      void (async () => {
        const previewOptions = buildQrOptions(content, style, PREVIEW_SIZE)
        container.innerHTML = ''
        new QRCodeStyling(previewOptions).append(container)
        if (mobileContainer) {
          mobileContainer.innerHTML = ''
          new QRCodeStyling({ ...buildQrOptions(content, style, 192), type: 'svg' }).append(mobileContainer)
        }
        // 在最小导出分辨率（512px）上做 jsQR 自检，避免高密度码被 260px 预览缩放误判
        const checkOptions = buildQrOptions(content, style, Math.max(512, PREVIEW_SIZE))
        const check = await selfCheckQr(checkOptions, content)
        if (seqRef.current !== seq) return
        setSelfCheck(check)
      })()
    }, 320)
    return () => window.clearTimeout(timer)
  }, [content, defaultColor, style, visible])

  const isUnsafe = selfCheck === 'unreadable' || selfCheck === 'mismatch'

  const requireRiskConfirmation = (actionKey: string): boolean => {
    if (!isUnsafe || unsafeConfirmed) return true
    if (pendingExportKey === actionKey) {
      setUnsafeConfirmed(true)
      setPendingExportKey(null)
      return true
    }
    setPendingExportKey(actionKey)
    toast('当前二维码自检未通过，再次点击按钮以确认仍要导出')
    return false
  }

  const exportImage = async (ext: 'png' | 'svg', size: number, label: string) => {
    if (!content || exporting) return
    const actionKey = `${ext}-${size}`
    if (!requireRiskConfirmation(actionKey)) return
    setExporting(true)
    try {
      const blob = await renderQrBlob(content, style, size, ext)
      const where = await saveBlob(blob, qrFileName(ext))
      void logGenerate(content, kind)
      toast(`已导出 ${label} → ${where}`, openSavedAction())
    } catch (e) {
      toast(`导出失败：${e instanceof Error ? e.message : '渲染出错'}`)
    } finally {
      setExporting(false)
    }
  }

  const copyImage = async () => {
    if (!content || exporting) return
    if (!requireRiskConfirmation('copy')) return
    setExporting(true)
    try {
      const blob = await renderQrBlob(content, style, 1024, 'png')
      try {
        if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        haptic('success')
        void logGenerate(content, kind)
        toast('已复制图片到剪贴板')
      } catch {
        // WebView / 非安全上下文不支持写图片，回退成存文件（别让「复制」静默失败）
        const where = await saveBlob(blob, qrFileName('png'))
        void logGenerate(content, kind)
        toast(`当前环境不支持复制图片，已改为保存 → ${where}`, openSavedAction())
      }
    } catch (e) {
      toast(`生成失败：${e instanceof Error ? e.message : '渲染出错'}`)
    } finally {
      setExporting(false)
    }
  }

  if (!visible) return null

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      {/* 手机端顶部紧凑预览条：改字/调样式时不用滑到底部看码 */}
      <section className="md:hidden card p-3 flex items-center gap-3">
        <div
          className={cn(
            'w-16 h-16 rounded-[10px] border border-outline p-1 shrink-0 grid place-items-center overflow-hidden',
            style.transparentBg ? CHECKERBOARD_CLS : 'bg-white',
          )}
        >
          <div
            ref={mobilePreviewRef}
            className={cn('w-full h-full grid place-items-center [&_svg]:w-full [&_svg]:h-full', !content && 'hidden')}
          />
          {!content && <span className="text-[10px] text-on-surface-2 text-center leading-tight">待生成</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium truncate">
            {content ? '实时预览' : '填写下方内容后生成二维码'}
          </p>
          <p className={cn(
            'text-[11px] mt-0.5 leading-snug',
            isUnsafe ? 'text-danger' : selfCheck === 'ok' ? 'text-ok' : 'text-on-surface-2',
          )}>
            {!content
              ? '支持文本、网址、WiFi、名片、邮件与短信'
              : selfCheck === 'checking'
                ? '正在自检可读性…'
                : selfCheck === 'ok'
                  ? '自检通过 · 可正常识别'
                  : isUnsafe
                    ? '自检未通过 · 建议调整点型或码色'
                    : '准备就绪'}
          </p>
        </div>
        {content && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="shrink-0"
          >
            去导出
          </Button>
        )}
      </section>

      {/* 内容 + 样式 */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-[13.5px] font-semibold">内容</h2>
            <span className="text-[11px] text-on-surface-2">
              {content ? `${content.length} 字` : '填好必填项后生成'}
            </span>
          </div>
          {/* 窄屏 3×2 网格防溢出，sm 及以上用滑动分段条 */}
          <div
            role="tablist"
            aria-label="内容模板"
            className="grid grid-cols-3 gap-1 p-1 rounded-[12px] bg-surface-3/70 sm:hidden"
          >
            {KIND_OPTIONS.map((o) => {
              const active = o.value === kind
              const Icon = o.icon
              return (
                <button
                  key={o.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setKind(o.value)}
                  className={cn(
                    'h-10 px-2 rounded-[9px] text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none',
                    active ? 'bg-surface text-on-surface shadow-sm' : 'text-on-surface-2 hover:text-on-surface',
                  )}
                >
                  {Icon && <Icon size={14} strokeWidth={active ? 2.2 : 1.9} className="shrink-0" />}
                  <span>{o.label}</span>
                </button>
              )
            })}
          </div>
          <Segmented
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
            size="sm"
            ariaLabel="内容模板"
            showLabels
            className="hidden sm:inline-flex w-fit max-w-full"
          />

          {kind === 'text' && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={onFormBlur}
              rows={4}
              placeholder={'要编码的文本，例如：\n会议在 3 号楼 201，14:00 开始'}
              className={AREA_CLS}
            />
          )}

          {kind === 'url' && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={onFormBlur}
              placeholder="https://example.com（不写协议会自动补 https://）"
              className={INPUT_CLS}
            />
          )}

          {kind === 'wifi' && (
            <div className="flex flex-col gap-2.5">
              <input
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                onBlur={onFormBlur}
                placeholder="WiFi 名称（SSID）"
                className={INPUT_CLS}
              />
              <div className="flex gap-2.5">
                <input
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
                  onBlur={onFormBlur}
                  placeholder={wifiEnc === 'nopass' ? '无密码' : '密码'}
                  disabled={wifiEnc === 'nopass'}
                  type={wifiEnc === 'nopass' ? 'text' : 'password'}
                  className={cn(INPUT_CLS, 'flex-1 min-w-0', wifiEnc === 'nopass' && 'opacity-50')}
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
                <input value={vcName} onChange={(e) => setVcName(e.target.value)} onBlur={onFormBlur} placeholder="姓名（必填）" className={INPUT_CLS} />
                <input value={vcOrg} onChange={(e) => setVcOrg(e.target.value)} onBlur={onFormBlur} placeholder="组织" className={INPUT_CLS} />
                <input value={vcTitle} onChange={(e) => setVcTitle(e.target.value)} onBlur={onFormBlur} placeholder="职位" className={INPUT_CLS} />
                <input value={vcPhone} onChange={(e) => setVcPhone(e.target.value)} onBlur={onFormBlur} placeholder="电话" className={INPUT_CLS} />
                <input value={vcEmail} onChange={(e) => setVcEmail(e.target.value)} onBlur={onFormBlur} placeholder="邮箱" className={INPUT_CLS} />
                <input value={vcUrl} onChange={(e) => setVcUrl(e.target.value)} onBlur={onFormBlur} placeholder="个人主页" className={INPUT_CLS} />
              </div>
              <textarea
                value={vcNote}
                onChange={(e) => setVcNote(e.target.value)}
                onBlur={onFormBlur}
                rows={2}
                placeholder="备注（可选）"
                className={AREA_CLS}
              />
              <p className="text-[11px] text-on-surface-2 leading-relaxed">vCard 3.0 格式，扫码后可直接存入通讯录。</p>
            </div>
          )}

          {kind === 'email' && (
            <div className="flex flex-col gap-2.5">
              <input value={emTo} onChange={(e) => setEmTo(e.target.value)} onBlur={onFormBlur} placeholder="收件人（必填）" className={INPUT_CLS} />
              <input value={emSubject} onChange={(e) => setEmSubject(e.target.value)} onBlur={onFormBlur} placeholder="主题（可选）" className={INPUT_CLS} />
              <textarea value={emBody} onChange={(e) => setEmBody(e.target.value)} onBlur={onFormBlur} rows={3} placeholder="正文（可选）" className={AREA_CLS} />
            </div>
          )}

          {kind === 'sms' && (
            <div className="flex flex-col gap-2.5">
              <input value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)} onBlur={onFormBlur} placeholder="手机号（必填）" className={INPUT_CLS} />
              <textarea value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)} onBlur={onFormBlur} rows={3} placeholder="短信内容（可选）" className={AREA_CLS} />
            </div>
          )}
        </section>

        <section className="card p-4 flex flex-col gap-3">
          <h2 className="text-[13.5px] font-semibold">样式</h2>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-on-surface-2 shrink-0">点型</span>
            <Segmented asRadio options={DOT_OPTIONS} value={style.dotType} onChange={(v) => patchStyle({ dotType: v })} size="sm" ariaLabel="点型" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-on-surface-2 shrink-0">码眼</span>
            <Segmented asRadio options={EYE_OPTIONS} value={style.eyeType} onChange={(v) => patchStyle({ eyeType: v })} size="sm" ariaLabel="码眼" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-on-surface-2 shrink-0">码眼中心</span>
            <Segmented asRadio options={EYE_DOT_OPTIONS} value={style.eyeDotType} onChange={(v) => patchStyle({ eyeDotType: v })} size="sm" ariaLabel="码眼中心" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <span className="text-[12px] text-on-surface-2">容错等级</span>
              {ecForced && (
                <p className="text-[11px] text-on-surface-2/80 mt-0.5">圆点 / Logo 已自动升至 H</p>
              )}
            </div>
            <Segmented
              asRadio
              options={EC_OPTIONS}
              value={effectiveEc}
              disabled={ecForced}
              onChange={(v) => patchStyle({ errorCorrectionLevel: v })}
              size="sm"
              ariaLabel="容错等级"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-on-surface-2">透明背景</p>
              <p className="text-[11px] text-on-surface-2/80 mt-0.5">导出透明底 PNG / SVG，方便叠在海报上</p>
            </div>
            <JellySwitch checked={Boolean(style.transparentBg)} onChange={() => patchStyle({ transparentBg: !style.transparentBg })} label="透明背景" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-on-surface-2">渐变</p>
              <p className="text-[11px] text-on-surface-2/80 mt-0.5">主色 → 亮一档的同色系</p>
            </div>
            <JellySwitch checked={style.gradient} onChange={() => patchStyle({ gradient: !style.gradient })} label="渐变" />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <HexColorInput label="码色" value={shownColor} onChange={color => patchStyle({ color })} />
            {style.gradient && (
              <HexColorInput label="渐变色" value={shownGradientColor} onChange={gradientColor => patchStyle({ gradientColor })} />
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
          <div className={cn('rounded-[14px] border border-outline p-2.5', style.transparentBg ? CHECKERBOARD_CLS : 'bg-white')}>
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

        <section ref={exportSectionRef} className="card p-4 flex flex-col gap-2.5">
          <h2 className="text-[13.5px] font-semibold">导出</h2>

          {isUnsafe && (
            <div className="rounded-[10px] border border-danger/35 bg-danger/10 p-2.5 flex flex-col gap-2" role="alert">
              <p className="text-[11.5px] text-danger leading-relaxed flex items-start gap-1.5">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                <span>
                  {unsafeConfirmed
                    ? '已确认风险：下面导出按钮已解锁，建议导出后用手机实测扫码。'
                    : '自检未通过，直接保存可能无法扫描。请调整样式，或确认后再导出。'}
                </span>
              </p>
              {!unsafeConfirmed && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setUnsafeConfirmed(true)
                    setPendingExportKey(null)
                  }}
                  className="w-fit h-8"
                >
                  我已知晓风险，仍要导出
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void exportImage('png', 1024, 'PNG 1024')}
              disabled={!content || exporting}
              variant={pendingExportKey === 'png-1024' ? 'destructive' : 'primary'}
              size="sm"
            >
              {pendingExportKey === 'png-1024' ? '确认导出 PNG 1024？' : 'PNG 1024'}
            </Button>
            <Button
              onClick={() => void exportImage('png', 512, 'PNG 512')}
              disabled={!content || exporting}
              variant={pendingExportKey === 'png-512' ? 'destructive' : 'outline'}
              size="sm"
            >
              {pendingExportKey === 'png-512' ? '确认导出 512？' : 'PNG 512'}
            </Button>
            <Button
              onClick={() => void exportImage('png', 2048, 'PNG 2048')}
              disabled={!content || exporting}
              variant={pendingExportKey === 'png-2048' ? 'destructive' : 'outline'}
              size="sm"
            >
              {pendingExportKey === 'png-2048' ? '确认导出 2048？' : 'PNG 2048'}
            </Button>
            <Button
              onClick={() => void exportImage('svg', 1024, 'SVG')}
              disabled={!content || exporting}
              variant={pendingExportKey === 'svg-1024' ? 'destructive' : 'outline'}
              size="sm"
            >
              {pendingExportKey === 'svg-1024' ? '确认导出 SVG？' : 'SVG'}
            </Button>
            <Button
              onClick={() => void copyImage()}
              disabled={!content || exporting}
              variant={pendingExportKey === 'copy' ? 'destructive' : 'outline'}
              size="sm"
            >
              <Copy size={14} /> {pendingExportKey === 'copy' ? '确认复制？' : '复制图片'}
            </Button>
          </div>
          <p className="text-[11px] text-on-surface-2 leading-relaxed">
            复制图片走系统剪贴板；环境不支持时自动改成保存文件。
          </p>
        </section>
      </div>
    </div>
  )
}
