/**
 * 二维码内容模板（纯函数，node 环境可测）。
 *
 * 每个模板的输出就是扫码后拿到的原始字符串：
 * - 文本：原样
 * - 网址：补全协议后的 URL
 * - WiFi：`WIFI:T:WPA;S:名称;P:密码;;`（`;` `:` `\` `,` 是语法字符，值里必须转义）
 * - 名片：vCard 3.0 文本
 * - 邮件：`mailto:收件人?subject=..&body=..`
 * - 短信：`SMSTO:号码:内容`
 *
 * 与 db.QrHistoryRow.kind 的取值保持一致。
 */
export type QrKind = 'text' | 'url' | 'wifi' | 'vcard' | 'email' | 'sms'

export const QR_KIND_LABEL: Record<QrKind, string> = {
  text: '文本',
  url: '网址',
  wifi: 'WiFi',
  vcard: '名片',
  email: '邮件',
  sms: '短信',
}

/* ---------------- WiFi ---------------- */

/**
 * WiFi 配置串转义：`;` `:` `\` `,` 前加反斜杠（安卓扫码端按此还原）。
 * 顺序要紧：先转义反斜杠自身，再转义其它字符，避免二次转义。
 */
export function escapeWifiValue(value: string): string {
  return value.replace(/([\\;:,])/g, '\\$1')
}

/** 还原 WiFi 串里转义的语法字符（单趟匹配避免二次反转义） */
export function unescapeWifiValue(value: string): string {
  return value.replace(/\\([\\;:,"])/g, '$1')
}

export interface WifiFields {
  ssid: string
  password?: string
  /** WPA/WPA2 | WEP | 无密码 */
  encryption?: 'WPA' | 'WEP' | 'nopass'
}

/** 拼 WIFI: 串。无密码时统一 T:nopass 且不写 P 段 */
export function buildWifiContent(fields: WifiFields): string {
  const enc = fields.encryption ?? (fields.password ? 'WPA' : 'nopass')
  const parts = [`T:${enc}`, `S:${escapeWifiValue(fields.ssid)}`]
  if (enc !== 'nopass' && fields.password) parts.push(`P:${escapeWifiValue(fields.password)}`)
  // 结尾 ;; 是 WIFI 串的固定收尾（最后一条目后跟空段）
  return `WIFI:${parts.join(';')};;`
}

/* ---------------- 名片 vCard 3.0 ---------------- */

/** vCard 3.0 文本值转义：`\` `;` `,` 与换行（换行统一成 \n 两个字符） */
export function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** 还原 vCard 转义（单趟处理 `\\` `\;` `\,` `\n`，防止 `\\n` 被误折行） */
export function unescapeVCardValue(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch))
}

export interface VCardFields {
  /** 姓名（必填才生成） */
  name: string
  org?: string
  title?: string
  phone?: string
  email?: string
  url?: string
  note?: string
}

/** 拼 vCard 3.0。行分隔用规范要求的 CRLF */
export function buildVCardContent(fields: VCardFields): string {
  const esc = escapeVCardValue
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  // N 是「姓;名;中间名;前缀;后缀」五段结构；中文姓名不拆，整体放姓氏位
  lines.push(`N:${esc(fields.name)};;;;`)
  lines.push(`FN:${esc(fields.name)}`)
  if (fields.org) lines.push(`ORG:${esc(fields.org)}`)
  if (fields.title) lines.push(`TITLE:${esc(fields.title)}`)
  if (fields.phone) lines.push(`TEL;TYPE=CELL,VOICE:${esc(fields.phone)}`)
  if (fields.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(fields.email)}`)
  if (fields.url) lines.push(`URL:${esc(fields.url)}`)
  if (fields.note) lines.push(`NOTE:${esc(fields.note)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/* ---------------- 邮件 / 短信 ---------------- */

export interface EmailFields {
  to: string
  subject?: string
  body?: string
}

/** mailto: 串。主题与正文走 query，需要 URL 编码 */
export function buildEmailContent(fields: EmailFields): string {
  const params: string[] = []
  if (fields.subject) params.push(`subject=${encodeURIComponent(fields.subject)}`)
  if (fields.body) params.push(`body=${encodeURIComponent(fields.body)}`)
  const to = fields.to.trim()
  return params.length ? `mailto:${to}?${params.join('&')}` : `mailto:${to}`
}

export interface SmsFields {
  phone: string
  message?: string
}

/** SMSTO: 串（ZXing 系扫码器认这个格式） */
export function buildSmsContent(fields: SmsFields): string {
  const phone = fields.phone.trim()
  return fields.message ? `SMSTO:${phone}:${fields.message}` : `SMSTO:${phone}`
}

/* ---------------- 网址 / 判别 ---------------- */

/** 网址模板：没写协议时补 https://，否则扫出来会被当成纯文本 */
export function buildUrlContent(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

/** 识别结果是否算「网址」（只有 http/https 才给「打开链接」按钮） */
export function isWebUrl(content: string): boolean {
  return /^https?:\/\//i.test(content.trim())
}

/* ---------------- 解析还原（历史回填 + 扫码结构化卡片） ---------------- */

export type ParsedQrPayload =
  | { kind: 'wifi'; fields: WifiFields }
  | { kind: 'vcard'; fields: VCardFields }
  | { kind: 'email'; fields: EmailFields }
  | { kind: 'sms'; fields: SmsFields }
  | { kind: 'url'; fields: { url: string } }
  | { kind: 'text'; fields: { text: string } }

function splitUnescapedSegments(body: string, sep: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) {
      cur += ch + body[i + 1]
      i++
      continue
    }
    if (ch === sep) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

function parseWifiPayload(raw: string): WifiFields | null {
  if (!/^WIFI:/i.test(raw)) return null
  const body = raw.slice(5)
  const segments = splitUnescapedSegments(body, ';').filter(Boolean)
  let ssid = ''
  let password = ''
  let rawEnc = ''
  let sawKey = false
  for (const seg of segments) {
    const colon = seg.indexOf(':')
    if (colon <= 0) continue
    const key = seg.slice(0, colon).trim().toUpperCase()
    const val = unescapeWifiValue(seg.slice(colon + 1))
    if (key === 'S') { ssid = val; sawKey = true }
    else if (key === 'P') { password = val; sawKey = true }
    else if (key === 'T') { rawEnc = val.trim().toUpperCase(); sawKey = true }
  }
  if (!sawKey) return null
  const encryption: WifiFields['encryption'] =
    rawEnc === 'NOPASS' || (!rawEnc && !password) ? 'nopass'
      : rawEnc === 'WEP' ? 'WEP'
        : 'WPA'
  return { ssid, ...(encryption !== 'nopass' && password ? { password } : {}), encryption }
}

function parseVCardPayload(raw: string): VCardFields | null {
  const unfolded = raw.trim().replace(/\r?\n[ \t]/g, '')
  if (!/^BEGIN:VCARD\b/i.test(unfolded)) return null
  const fields: VCardFields = { name: '' }
  let fallbackN = ''
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const rawProp = line.slice(0, colon).split(';')[0].trim().toUpperCase()
    const prop = rawProp.includes('.') ? rawProp.slice(rawProp.indexOf('.') + 1) : rawProp
    const val = line.slice(colon + 1)
    if (prop === 'FN') fields.name = unescapeVCardValue(val).trim()
    else if (prop === 'N' && !fallbackN) {
      const parts = splitUnescapedSegments(val, ';').map((p) => unescapeVCardValue(p).trim()).filter(Boolean)
      fallbackN = parts.join(' ')
    } else if (prop === 'ORG' && !fields.org) fields.org = unescapeVCardValue(val).trim()
    else if (prop === 'TITLE' && !fields.title) fields.title = unescapeVCardValue(val).trim()
    else if (prop === 'TEL' && !fields.phone) fields.phone = unescapeVCardValue(val).trim()
    else if (prop === 'EMAIL' && !fields.email) fields.email = unescapeVCardValue(val).trim()
    else if (prop === 'URL' && !fields.url) fields.url = unescapeVCardValue(val).trim()
    else if (prop === 'NOTE' && !fields.note) fields.note = unescapeVCardValue(val)
  }
  if (!fields.name) fields.name = fallbackN
  if (!fields.name && !fields.phone && !fields.email && !fields.org) return null
  return fields
}

function safeDecodeQueryValue(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function parseEmailPayload(raw: string): EmailFields | null {
  if (!/^mailto:/i.test(raw)) return null
  const rest = raw.slice(7)
  const qIdx = rest.indexOf('?')
  const to = safeDecodeQueryValue((qIdx >= 0 ? rest.slice(0, qIdx) : rest).trim())
  const query = qIdx >= 0 ? rest.slice(qIdx + 1) : ''
  const params = new URLSearchParams(query)
  const subject = params.get('subject') ?? undefined
  const body = params.get('body') ?? undefined
  return { to, ...(subject ? { subject } : {}), ...(body ? { body } : {}) }
}

function parseSmsPayload(raw: string): SmsFields | null {
  if (/^SMSTO:/i.test(raw)) {
    const rest = raw.slice(6)
    const colon = rest.indexOf(':')
    if (colon < 0) return { phone: rest.trim() }
    const phone = rest.slice(0, colon).trim()
    const message = rest.slice(colon + 1)
    return { phone, ...(message ? { message } : {}) }
  }
  if (/^sms:/i.test(raw)) {
    const rest = raw.slice(4)
    const qIdx = rest.indexOf('?')
    const phone = (qIdx >= 0 ? rest.slice(0, qIdx) : rest).trim()
    const params = qIdx >= 0 ? new URLSearchParams(rest.slice(qIdx + 1)) : null
    const message = params?.get('body') ?? undefined
    return { phone, ...(message ? { message } : {}) }
  }
  return null
}

/** 把二维码内容串解析回结构化模板字段（历史回填与扫码结果卡片共用） */
export function parseQrTemplate(raw: string): ParsedQrPayload {
  const trimmed = raw.trim()
  const wifi = parseWifiPayload(trimmed)
  if (wifi) return { kind: 'wifi', fields: wifi }
  const vcard = parseVCardPayload(trimmed)
  if (vcard) return { kind: 'vcard', fields: vcard }
  const email = parseEmailPayload(trimmed)
  if (email) return { kind: 'email', fields: email }
  const sms = parseSmsPayload(trimmed)
  if (sms) return { kind: 'sms', fields: sms }
  if (isWebUrl(trimmed)) return { kind: 'url', fields: { url: trimmed } }
  return { kind: 'text', fields: { text: raw } }
}
