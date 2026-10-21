// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { parseFlowDoc } from './flowDoc'

/**
 * 「恶意文档输入」回归：EPUB 的章节 HTML 来自外部文件，
 * 之前 `onerror` 会被原样保留，插进 DOM 就执行。
 * 现在解析阶段统一过 sanitizeHtml，等于在数据入口就断掉。
 */
async function makeEpub(chapterHtml: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles>'
    + '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
    + '</rootfiles></container>',
  )
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0"?><package><manifest>'
    + '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>'
    + '</manifest><spine><itemref idref="c1"/></spine></package>',
  )
  zip.file('OEBPS/chapter1.xhtml', chapterHtml)
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new Blob([buf], { type: 'application/epub+zip' })
}

describe('parseFlowDoc(epub) 清洗', () => {
  it('章节里的 script 与 onerror 不会进入渲染 HTML', async () => {
    const blob = await makeEpub(
      '<html><body><h1>第一章</h1>'
      + '<p>正常正文内容。</p>'
      + '<img src="https://evil.test/x.png" onerror="globalThis.__pwned = 1">'
      + '<script>globalThis.__pwned = 2</script>'
      + '<a href="javascript:alert(1)">点我</a>'
      + '</body></html>',
    )
    const doc = await parseFlowDoc('epub', blob)
    expect(doc.segments).toHaveLength(1)
    const html = doc.segments[0].html
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain('正常正文内容')
    // 纯文本索引不受影响
    expect(doc.text).toContain('正常正文内容')
  })
})
