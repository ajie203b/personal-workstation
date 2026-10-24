import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildReport } from './buildDocx'
import type { Block, ReportLogos } from './types'

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
)
const logos: ReportLogos = {
  cover: { data: PNG, type: 'png', width: 1, height: 1 },
  header: { data: PNG, type: 'png', width: 1, height: 1 },
}

const meta = {
  course: '国防特色通识教育-自动控制篇',
  reportType: '大作业',
  title: '自动控制技术在国防军工领域的应用及发展',
  name: '测试同学',
  studentId: '923101760133',
  college: '机械工程学院',
  major: '引信',
  teacher: '测试老师',
  date: '2026年10月',
  score: '',
}

describe('NJUST Word 生成', () => {
  it('写入模板要求的字体、行距、缩进、三线表、封面和页眉页脚', async () => {
    const blocks: Block[] = [
      { type: 'heading', level: 1, text: '一、引言' },
      { type: 'paragraph', inlines: [{ type: 'text', text: '这是正文第一段。' }] },
      { type: 'table', headers: ['项目', '说明'], rows: [['A', 'B']], caption: '表1-1 示例' },
    ]
    const { blob, warnings } = await buildReport({
      meta,
      blocks,
      options: { cover: true, reviewBox: true, headerFooter: true, autoNumberHeadings: true },
      logos,
    })
    expect(warnings).toEqual([])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('w:line="400"')
    expect(doc).toContain('w:lineRule="exact"')
    expect(doc).toContain('w:firstLine="480"')
    expect(doc).toContain('w:eastAsia="宋体"')
    expect(doc).toContain('w:sz w:val="24"')
    expect(doc).toContain('w:sz="12"')
    expect(doc).toContain('w:sz="6"')
    expect(doc).toContain('w:pgMar')
    expect(doc).toContain('国防特色通识教育-自动控制篇')
    expect(doc).toContain('大作业')
    expect(doc).toContain('评  语：')
    expect(doc).toContain('测试同学')
    expect(doc).toContain('引言')
    expect(doc).toContain('这是正文第一段。')

    const headerName = Object.keys(zip.files).find((n) => /^word\/header\d+\.xml$/.test(n))
    const footerName = Object.keys(zip.files).find((n) => /^word\/footer\d+\.xml$/.test(n))
    const header = headerName ? await zip.file(headerName)!.async('string') : ''
    const footer = footerName ? await zip.file(footerName)!.async('string') : ''
    expect(header).toContain('课程报告')
    expect(footer).toMatch(/PAGE|SECTIONPAGES|TOTAL_PAGES/)
  })
})
