import { describe, expect, it } from 'vitest'
import { transformDocUrl } from './links'

describe('transformDocUrl', () => {
  it('放行 http(s) / mailto / tel', () => {
    expect(transformDocUrl('https://example.com')).toBe('https://example.com')
    expect(transformDocUrl('http://a.b/c')).toBe('http://a.b/c')
    expect(transformDocUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(transformDocUrl('tel:10086')).toBe('tel:10086')
  })
  it('放行 data:image（正文插图就是 data URL）', () => {
    expect(transformDocUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
  })
  it('放行锚点与相对地址', () => {
    expect(transformDocUrl('#list')).toBe('#list')
    expect(transformDocUrl('docs/readme.md')).toBe('docs/readme.md')
    expect(transformDocUrl('/abs/path')).toBe('/abs/path')
  })
  it('其它协议清空', () => {
    expect(transformDocUrl('javascript:alert(1)')).toBe('')
    expect(transformDocUrl('data:text/html;base64,AAA')).toBe('')
  })
})
