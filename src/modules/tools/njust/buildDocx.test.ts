import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildReport, cnNo } from './buildDocx'
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
      {
        type: 'table',
        headers: [[{ type: 'text', text: '项目' }], [{ type: 'text', text: '说明' }]],
        rows: [[[{ type: 'text', text: 'A', bold: true }], [{ type: 'math', latex: 'x^2' }]]],
        caption: '表1-1 示例',
      },
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
    // 表格单元格支持原生 OMML 数学公式
    expect(doc).toContain('<m:oMath>')

    // styles.xml 显式锁定 Heading1/2/3 为宋体/黑体 + #000000
    const styles = await zip.file('word/styles.xml')!.async('string')
    expect(styles).toContain('Heading1')
    expect(styles).toContain('w:color w:val="000000"')
    expect(styles).not.toContain('2F5496')

    const headerName = Object.keys(zip.files).find((n) => /^word\/header\d+\.xml$/.test(n))
    const footerName = Object.keys(zip.files).find((n) => /^word\/footer\d+\.xml$/.test(n))
    const header = headerName ? await zip.file(headerName)!.async('string') : ''
    const footer = footerName ? await zip.file(footerName)!.async('string') : ''
    expect(header).toContain('课程报告')
    expect(footer).toMatch(/PAGE|SECTIONPAGES|TOTAL_PAGES/)
  })

  it('支持嵌套列表安全缩进、高行内公式自动最小行距、代码块段落底纹、自定义报告类型与无 Logo 模式', async () => {
    expect(cnNo(20)).toBe('二十')
    expect(cnNo(21)).toBe('二十一')
    expect(cnNo(35)).toBe('三十五')

    const blocks: Block[] = [
      { type: 'paragraph', inlines: [{ type: 'text', text: '包含分式 ' }, { type: 'math', latex: '\\frac{a}{b}' }] },
      {
        type: 'list',
        ordered: true,
        items: [
          { ordered: true, depth: 0, inlines: [{ type: 'text', text: '一级条目' }] },
          { ordered: false, depth: 1, inlines: [{ type: 'text', text: '二级子条目' }] },
        ],
      },
      { type: 'code', text: 'const x = 1\nconst y = 2', lang: 'ts' },
    ]
    const { blob } = await buildReport({
      meta: { ...meta, name: '', studentId: '', reportType: '实验报告' },
      blocks,
      options: { cover: false, reviewBox: false, headerFooter: false, autoNumberHeadings: true },
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('w:lineRule="atLeast"')
    expect(doc).not.toContain('w:hanging=')
    expect(doc).toContain('w:tabs')
    expect(doc).toContain('w:shd')
    expect(doc).toContain('w:pBdr')
    expect(doc).not.toContain('学号：')

    const { blob: withHeader } = await buildReport({
      meta: { ...meta, reportType: '实验报告' },
      blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text: '测试' }] }],
      options: { cover: false, reviewBox: false, headerFooter: true, autoNumberHeadings: true },
      logos,
    })
    const zip2 = await JSZip.loadAsync(await withHeader.arrayBuffer())
    const headerName = Object.keys(zip2.files).find((n) => /^word\/header\d+\.xml$/.test(n))
    const header = headerName ? await zip2.file(headerName)!.async('string') : ''
    expect(header).toContain('实验报告')
  })
})
