import { useEffect, useMemo, useRef, useState } from 'react'
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
  Upload,
  Wifi,
  X,
} from 'lucide-react'
import QRCodeStyling from 'qr-code-styling'
import { Button } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented, type SegmentOption } from '@/shared/ui/Segmented'
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
  type QrKind,
} from './qrTemplates'
import {
  buildQrOptions,
  qrFileName,
  qrSafeColor,
  readPrimaryColor,
  renderQrBlob,
  selfCheckQr,
  shadeHex,
  type QrDotType,
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

const INPUT_CLS =
  'w-full h-10 px-3 rounded-[10px] bg-surface border border-outline text-[13.5px] outline-none focus:border-primary/60 placeholder:text-on-surface-2/70'
const AREA_CLS =
  'w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[80px]'
const PREVIEW_SIZE = 260

export function QrGenerateTab({
  visible,
  prefill,
}: {
  visible: boolean
  prefill: { value: string; seq: number } | null
}) {
  const toast = useUi((s) => s.toast)

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
    setKind('text')
    setText(prefill.value)
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

  const [defaultColor] = useState(() => qrSafeColor(readPrimaryColor()))
  const shownColor = style.color || defaultColor
  const shownGradientColor = style.gradientColor || shadeHex(defaultColor, 0.22)

  const logoInputRef = useRef<HTMLInputElement>(null)
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
    if (!visible) return
    const seq = ++seqRef.current
    const container = previewRef.current
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
  }, [content, kind, style, visible])

  const exportImage = async (ext: 'png' | 'svg', size: number, label: string) => {
    if (!content || exporting) return
    setExporting(true)
    try {
      const blob = await renderQrBlob(content, style, size, ext)
      const where = await saveBlob(blob, qrFileName(ext))
      toast(`已导出 ${label} → ${where}`, openSavedAction())
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
            options={KIND_OPTIONS}
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
              className={AREA_CLS}
            />
          )}

          {kind === 'url' && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com（不写协议会自动补 https://）"
              className={INPUT_CLS}
            />
          )}

          {kind === 'wifi' && (
            <div className="flex flex-col gap-2.5">
              <input
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                placeholder="WiFi 名称（SSID）"
                className={INPUT_CLS}
              />
              <div className="flex gap-2.5">
                <input
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
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
                <input value={vcName} onChange={(e) => setVcName(e.target.value)} placeholder="姓名（必填）" className={INPUT_CLS} />
                <input value={vcOrg} onChange={(e) => setVcOrg(e.target.value)} placeholder="组织" className={INPUT_CLS} />
                <input value={vcTitle} onChange={(e) => setVcTitle(e.target.value)} placeholder="职位" className={INPUT_CLS} />
                <input value={vcPhone} onChange={(e) => setVcPhone(e.target.value)} placeholder="电话" className={INPUT_CLS} />
                <input value={vcEmail} onChange={(e) => setVcEmail(e.target.value)} placeholder="邮箱" className={INPUT_CLS} />
                <input value={vcUrl} onChange={(e) => setVcUrl(e.target.value)} placeholder="个人主页" className={INPUT_CLS} />
              </div>
              <textarea
                value={vcNote}
                onChange={(e) => setVcNote(e.target.value)}
                rows={2}
                placeholder="备注（可选）"
                className={AREA_CLS}
              />
              <p className="text-[11px] text-on-surface-2 leading-relaxed">vCard 3.0 格式，扫码后可直接存入通讯录。</p>
            </div>
          )}

          {kind === 'email' && (
            <div className="flex flex-col gap-2.5">
              <input value={emTo} onChange={(e) => setEmTo(e.target.value)} placeholder="收件人（必填）" className={INPUT_CLS} />
              <input value={emSubject} onChange={(e) => setEmSubject(e.target.value)} placeholder="主题（可选）" className={INPUT_CLS} />
              <textarea value={emBody} onChange={(e) => setEmBody(e.target.value)} rows={3} placeholder="正文（可选）" className={AREA_CLS} />
            </div>
          )}

          {kind === 'sms' && (
            <div className="flex flex-col gap-2.5">
              <input value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)} placeholder="手机号（必填）" className={INPUT_CLS} />
              <textarea value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)} rows={3} placeholder="短信内容（可选）" className={AREA_CLS} />
            </div>
          )}
        </section>

        <section className="card p-4 flex flex-col gap-3">
          <h2 className="text-[13.5px] font-semibold">样式</h2>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-on-surface-2 shrink-0">点型</span>
            <Segmented options={DOT_OPTIONS} value={style.dotType} onChange={(v) => patchStyle({ dotType: v })} size="sm" ariaLabel="点型" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-on-surface-2 shrink-0">码眼</span>
            <Segmented options={EYE_OPTIONS} value={style.eyeType} onChange={(v) => patchStyle({ eyeType: v })} size="sm" ariaLabel="码眼" />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12px] text-on-surface-2 shrink-0">码眼中心</span>
            <Segmented options={EYE_DOT_OPTIONS} value={style.eyeDotType} onChange={(v) => patchStyle({ eyeDotType: v })} size="sm" ariaLabel="码眼中心" />
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
  )
}
