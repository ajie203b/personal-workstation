// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ native: false }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
}))

import { openExternal, transformDocUrl } from './links'

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

describe('openExternal', () => {
  beforeEach(() => {
    state.native = false
  })

  it('网页端开新标签', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    openExternal('https://example.com/a')
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank')
    open.mockRestore()
  })

  it('安卓壳走同窗锚点跳转（window.open 会被 WebView 静默丢掉）', () => {
    state.native = true
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let clicked = ''
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this.getAttribute('href') ?? ''
      })
    openExternal('https://example.com/b')
    expect(clicked).toBe('https://example.com/b')
    expect(open).not.toHaveBeenCalled()
    expect(document.querySelectorAll('a')).toHaveLength(0) // 用完即拆
    click.mockRestore()
    open.mockRestore()
  })
})
