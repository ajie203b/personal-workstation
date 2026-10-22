// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildArticleMarkdown, formatCapturedAt } from './articleMarkdown'

const CONTENT_HTML = `
  <h2>小节标题</h2>
  <p>正文第一段，包含<strong>加粗</strong>与<em>强调</em>。</p>
  <p>正文第二段。</p>
  <ul><li>要点一</li><li>要点二</li></ul>
  <table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
`

const CAPTURED_AT = new Date(2026, 9, 22, 15, 30).getTime() // 2026-10-22 15:30

describe('formatCapturedAt', () => {
  it('输出 YYYY-MM-DD HH:mm', () => {
    expect(formatCapturedAt(CAPTURED_AT)).toMatch(/^2026-10-22 \d{2}:\d{2}$/)
  })
})

describe('buildArticleMarkdown', () => {
  it('文首写来源 URL、标题、抓取时间', () => {
    const md = buildArticleMarkdown({
      title: '测试文章',
      byline: '作者甲',
      sourceUrl: 'https://blog.test/posts/1',
      capturedAt: CAPTURED_AT,
      contentHtml: CONTENT_HTML,
    })
    expect(md.startsWith('# 测试文章')).toBe(true)
    expect(md).toContain('> 来源：https://blog.test/posts/1')
    expect(md).toContain('> 作者：作者甲')
    expect(md).toContain('> 抓取时间：2026-10-22')
    // 来源块在正文之前
    expect(md.indexOf('来源：')).toBeLessThan(md.indexOf('正文第一段'))
    expect(md).toContain('---')
  })

  it('turndown + gfm：标题 / 列表 / 表格 / 强调都转出来', () => {
    const md = buildArticleMarkdown({
      title: '测试文章',
      sourceUrl: 'https://blog.test/posts/1',
      capturedAt: CAPTURED_AT,
      contentHtml: CONTENT_HTML,
    })
    expect(md).toContain('## 小节标题')
    expect(md).toContain('**加粗**')
    expect(md).toMatch(/-\s+要点一/)
    expect(md).toContain('| 列A') // GFM 表格
    expect(md).toContain('| ---')
    expect(md).toContain('| 1 | 2 |')
  })

  it('没有来源链接时明说，不留空洞', () => {
    const md = buildArticleMarkdown({
      title: '粘贴的正文',
      capturedAt: CAPTURED_AT,
      contentHtml: '<p>只有一段。</p>',
    })
    expect(md).toContain('> 来源：（粘贴内容，无来源链接）')
    expect(md).toContain('只有一段。')
  })

  it('图片 dataURL 原样保留', () => {
    const md = buildArticleMarkdown({
      title: '带图',
      capturedAt: CAPTURED_AT,
      contentHtml: '<p>看图</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="图">',
    })
    expect(md).toContain('![图](data:image/png;base64,iVBORw0KGgo=)')
  })
})
