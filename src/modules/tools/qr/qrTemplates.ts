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
