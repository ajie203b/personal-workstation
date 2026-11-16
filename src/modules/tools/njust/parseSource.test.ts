import { describe, expect, it } from 'vitest'
import { parseMarkdownSource, parseTextSource } from './parseSource'
import type { Block } from './types'

describe('NJUST 报告输入解析', () => {
  it('把首个一级标题作为报告题目，并保留后续一级标题', () => {
    const parsed = parseMarkdownSource('# 报告题目\n\n# 一、引言\n\n正文第一段。\n\n## 1.1 背景\n\n背景正文。')
    expect(parsed.title).toBe('报告题目')
    expect(parsed.blocks[0]).toMatchObject({ type: 'heading', level: 1, text: '一、引言' })
    expect(parsed.blocks.some((b) => b.type === 'heading' && b.level === 2)).toBe(true)
  })

  it('解析 GFM 表格（含富文本/公式单元格）、公式、图片和列表', () => {
    const parsed = parseMarkdownSource([
      '# 题目',
      '段落里有 $x_i^2$ 和 **加粗**。',
      '',
      '| 项目 | 数值 |',
      '| --- | --- |',
      '| **A** | `k` = $x^2$ |',
      '',
      '$$\\frac{a}{b}=c$$',
      '',
      '![图1-1 示例](data:image/png;base64,AAAA)',
      '',
      '- 第一项',
      '- 第二项',
    ].join('\n'))
    expect(parsed.stats.tables).toBe(1)
    expect(parsed.stats.images).toBe(1)
    expect(parsed.stats.formulas).toBe(3)
    expect(parsed.stats.lists).toBe(1)
    const table = parsed.blocks.find((b): b is Extract<Block, { type: 'table' }> => b.type === 'table')
    expect(table?.rows[0]?.[0]).toEqual([{ type: 'text', text: 'A', bold: true }])
    expect(table?.rows[0]?.[1]).toEqual([
      { type: 'text', text: 'k', code: true },
      { type: 'text', text: ' = ' },
      { type: 'math', latex: 'x^2' },
    ])
    const image = parsed.blocks.find((b) => b.type === 'image')
    expect(image && image.type === 'image' ? image.caption : null).toBe('图1-1 示例')
  })

  it('递归解析 Markdown 与纯文本嵌套列表（含 depth 与有序/无序混合）', () => {
    const md = parseMarkdownSource([
      '1. 一级有序',
      '   - 二级无序甲',
      '   - 二级无序乙',
      '     1. 三级有序',
      '2. 一级有序二',
    ].join('\n'))
    const mdList = md.blocks.find((b): b is Extract<Block, { type: 'list' }> => b.type === 'list')
    expect(mdList?.items).toHaveLength(5)
    expect(mdList?.items.map((i) => ({ depth: i.depth, ordered: i.ordered }))).toEqual([
      { depth: 0, ordered: true },
      { depth: 1, ordered: false },
      { depth: 1, ordered: false },
      { depth: 2, ordered: true },
      { depth: 0, ordered: true },
    ])

    const txt = parseTextSource('1. 主条目\n  - 子条目\n    1. 孙条目')
    const txtList = txt.blocks.find((b): b is Extract<Block, { type: 'list' }> => b.type === 'list')
    expect(txtList?.items.map((i) => ({ depth: i.depth, ordered: i.ordered }))).toEqual([
      { depth: 0, ordered: true },
      { depth: 1, ordered: false },
      { depth: 2, ordered: true },
    ])
  })

  it('把表格前的表题移作题注', () => {
    const parsed = parseMarkdownSource('表1-1  数据\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
    const table = parsed.blocks.find((b) => b.type === 'table')
    expect(parsed.blocks.some((b) => b.type === 'paragraph')).toBe(false)
    expect(table && table.type === 'table' ? table.caption : null).toBe('表1-1  数据')
  })

  it('解析纯文本的一级/二级/三级标题和列表', () => {
    const parsed = parseTextSource('一、引言\n这是正文。\n1.1 背景\n背景正文。\n1.1.1 细节\n- 条目一\n- 条目二')
    expect(parsed.title).toBeUndefined()
    expect(parsed.blocks.filter((b) => b.type === 'heading')).toHaveLength(3)
    const h3 = parsed.blocks.find((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading' && b.level === 3)
    expect(h3?.text).toBe('细节')
    expect(parsed.blocks.find((b) => b.type === 'list')).toMatchObject({ type: 'list', ordered: false })
    expect(parsed.stats.words).toBeGreaterThan(0)
  })
})
