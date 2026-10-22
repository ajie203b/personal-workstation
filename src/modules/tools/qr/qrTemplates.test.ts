import { describe, expect, it } from 'vitest'
import {
  buildEmailContent,
  buildSmsContent,
  buildUrlContent,
  buildVCardContent,
  buildWifiContent,
  escapeVCardValue,
  escapeWifiValue,
  isWebUrl,
} from './qrTemplates'

describe('escapeWifiValue / buildWifiContent', () => {
  it('转义 ; : \\ , 四个语法字符', () => {
    expect(escapeWifiValue('a;b:c\\d,e')).toBe('a\\;b\\:c\\\\d\\,e')
  })
  it('普通值原样', () => {
    expect(escapeWifiValue('MyWiFi-5G')).toBe('MyWiFi-5G')
    expect(escapeWifiValue('')).toBe('')
  })

  it('拼出 WIFI:T:WPA;S:名称;P:密码;; 格式', () => {
    expect(buildWifiContent({ ssid: '名称', password: '密码', encryption: 'WPA' })).toBe('WIFI:T:WPA;S:名称;P:密码;;')
  })
  it('SSID / 密码里的语法字符被转义', () => {
    expect(buildWifiContent({ ssid: 'a;b', password: 'p:w\\,x', encryption: 'WPA' })).toBe(
      'WIFI:T:WPA;S:a\\;b;P:p\\:w\\\\\\,x;;',
    )
  })
  it('无密码走 T:nopass 且不写 P 段', () => {
    expect(buildWifiContent({ ssid: 'open', encryption: 'nopass' })).toBe('WIFI:T:nopass;S:open;;')
    expect(buildWifiContent({ ssid: 'open', password: '', encryption: 'nopass' })).toBe('WIFI:T:nopass;S:open;;')
  })
  it('WEP 与默认加密方式', () => {
    expect(buildWifiContent({ ssid: 'w', password: 'p', encryption: 'WEP' })).toBe('WIFI:T:WEP;S:w;P:p;;')
    // 不指定加密：有密码默认 WPA，没密码默认 nopass
    expect(buildWifiContent({ ssid: 'w', password: 'p' })).toBe('WIFI:T:WPA;S:w;P:p;;')
    expect(buildWifiContent({ ssid: 'w' })).toBe('WIFI:T:nopass;S:w;;')
  })
})

describe('escapeVCardValue / buildVCardContent', () => {
  it('转义反斜杠、分号、逗号与换行', () => {
    expect(escapeVCardValue('a\\b;c,d')).toBe('a\\\\b\\;c\\,d')
    expect(escapeVCardValue('第一行\n第二行')).toBe('第一行\\n第二行')
    expect(escapeVCardValue('第一行\r\n第二行')).toBe('第一行\\n第二行')
  })

  it('vCard 3.0 结构：VERSION、N/FN、END 齐全，行分隔 CRLF', () => {
    const card = buildVCardContent({ name: '张三', org: 'ACME', phone: '13800000000', email: 'a@b.com' })
    const lines = card.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCARD')
    expect(lines[1]).toBe('VERSION:3.0')
    expect(lines).toContain('N:张三;;;;')
    expect(lines).toContain('FN:张三')
    expect(lines[toContainIndex(lines, 'ORG:')] as string).toBe('ORG:ACME')
    expect(lines).toContain('TEL;TYPE=CELL,VOICE:13800000000')
    expect(lines).toContain('EMAIL;TYPE=INTERNET:a@b.com')
    expect(lines[lines.length - 1]).toBe('END:VCARD')
    expect(card.endsWith('END:VCARD')).toBe(true)
    expect(card).not.toContain('\n\r')
  })

  it('可选字段留空就不写行；字段值里的分隔符被转义', () => {
    const card = buildVCardContent({ name: 'Doe; Jane', note: 'a,b' })
    expect(card).toContain('FN:Doe\\; Jane')
    expect(card).toContain('NOTE:a\\,b')
    expect(card).not.toContain('ORG:')
    expect(card).not.toContain('TEL')
    expect(card).not.toContain('EMAIL')
  })
})

describe('buildEmailContent / buildSmsContent', () => {
  it('mailto 只有收件人时不带问号段', () => {
    expect(buildEmailContent({ to: 'a@b.com' })).toBe('mailto:a@b.com')
  })
  it('主题与正文 URL 编码，中文可还原', () => {
    const s = buildEmailContent({ to: 'a@b.com', subject: '你好 世界', body: '第一行\n第二行' })
    const [head, query] = s.split('?')
    expect(head).toBe('mailto:a@b.com')
    const params = new URLSearchParams(query)
    expect(params.get('subject')).toBe('你好 世界')
    expect(params.get('body')).toBe('第一行\n第二行')
  })

  it('SMSTO:号码:内容', () => {
    expect(buildSmsContent({ phone: '10086', message: '查话费' })).toBe('SMSTO:10086:查话费')
    expect(buildSmsContent({ phone: '10086' })).toBe('SMSTO:10086')
  })
})

describe('buildUrlContent / isWebUrl', () => {
  it('没写协议补 https://，已有的不动', () => {
    expect(buildUrlContent('example.com/a')).toBe('https://example.com/a')
    expect(buildUrlContent('https://example.com')).toBe('https://example.com')
    expect(buildUrlContent('http://example.com')).toBe('http://example.com')
    expect(buildUrlContent('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
  it('只有 http/https 算网址', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('  http://example.com  ')).toBe(true)
    expect(isWebUrl('example.com')).toBe(false)
    expect(isWebUrl('WIFI:T:WPA;S:a;;')).toBe(false)
    expect(isWebUrl('普通文本')).toBe(false)
  })
})

/** lines 里找前缀行的下标（toContain 不带前缀匹配，避免匹配到错误行） */
function toContainIndex(lines: string[], prefix: string): number {
  const i = lines.findIndex((l) => l.startsWith(prefix))
  expect(i).toBeGreaterThanOrEqual(0)
  return i
}
