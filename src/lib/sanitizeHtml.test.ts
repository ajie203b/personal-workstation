// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isSafeUrl, sanitizeHtml } from './sanitizeHtml'

/**
 * 清洗规则回归：这些用例来自真实文档里能跑通的注入方式
 * （EPUB 的 img onerror、DOCX 里的 style/script、链接伪协议）。
 */
describe('sanitizeHtml', () => {
  it('剥掉事件属性（onerror 这类一行就能执行）', () => {
    const out = sanitizeHtml('<p><img src="x" onerror="globalThis.__pwned = 1"></p>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('__pwned')
  })

  it('危险容器整棵删掉（script/iframe/style/object/svg）', () => {
    const out = sanitizeHtml(
      '<div>正文<script>globalThis.__pwned=1</script><style>body{display:none}</style>'
      + '<iframe src="https://evil.test"></iframe><object data="x"></object>'
      + '<svg><script>1</script><text>svg</text></svg></div>',
    )
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<style')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<svg')
    expect(out).toContain('正文')
  })

  it('拦掉 javascript: / data:text/html 等危险协议', () => {
    const out = sanitizeHtml(
      '<a href="javascript:alert(1)">a</a><a href="JaVaScRiPt&#58;alert(1)">b</a>'
      + '<a href="data:text/html,<script>1</script>">c</a><img src="vbscript:msgbox(1)">',
    )
    expect(out).not.toMatch(/javascript:/i)
    expect(out).not.toContain('data:text/html')
    expect(out).not.toContain('vbscript')
  })

  it('保留正常阅读需要的结构与图片来源', () => {
    const out = sanitizeHtml(
      '<h2 class="c">标题</h2><p style="text-indent: 2em; color: red">段落<em>强调</em></p>'
      + '<img src="blob:https://app.test/abc" alt="图"><a href="https://example.com" target="_blank">链接</a>'
      + '<table><tr><td colspan="2">单元格</td></tr></table>',
    )
    expect(out).toContain('<h2 class="c">标题</h2>')
    expect(out).toContain('blob:https://app.test/abc')
    expect(out).toContain('colspan')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
  })

  it('行内样式只留排版属性，去掉 url() 与 expression()', () => {
    const out = sanitizeHtml('<p style="text-align:center;background:url(https://evil.test/x.png);position:fixed">x</p>')
    expect(out).toContain('text-align: center')
    expect(out).not.toContain('url(')
    expect(out).not.toContain('position')
  })

  it('不在白名单里的壳标签保留内容（docx 常见 o:p 之类）', () => {
    expect(sanitizeHtml('<o:p><span>内容</span></o:p>')).toContain('内容')
  })

  it('isSafeUrl 只放行 http/https/mailto/tel/blob/data:image 与相对路径', () => {
    expect(isSafeUrl('https://a.test/x')).toBe(true)
    expect(isSafeUrl('#anchor')).toBe(true)
    expect(isSafeUrl('chapter-2.xhtml')).toBe(true)
    expect(isSafeUrl('data:image/png;base64,AAA')).toBe(true)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html;base64,AAA')).toBe(false)
  })
})
