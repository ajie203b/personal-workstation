import { describe, expect, it } from 'vitest'
import { buildMathNoteMarkdown } from './exportMarkdown'
import type { BlockResult, NoteGraph } from './types'

describe('buildMathNoteMarkdown', () => {
  it('导出变量、内联与块级公式（优先使用用户编辑值）、近似值、图像与页脚', () => {
    const results: BlockResult[] = [
      {
        key: 'k1',
        recognized: 'x = 10',
        result: { kind: 'inline', latex: '10', text: '10', assigned: { name: 'x', value: '10' } },
      },
      {
        key: 'k2',
        recognized: '1 + 2 =',
        edited: '\\frac{1}{3} + \\frac{1}{6} =',
        result: { kind: 'inline', latex: '\\frac{1}{2}', text: '', alt: '0.5' },
      },
      {
        key: 'k3',
        recognized: 'x^2 - 4 = 0',
        result: { kind: 'solutions', latex: 'x = -2, 2', text: '' },
      },
      {
        key: 'k4',
        recognized: 'bad \\expr',
        result: { kind: 'error', latex: '', text: '', message: '无法解析' },
      },
    ]
    const graphs: NoteGraph[] = [
      { id: 'g1', expression: 'y = sin(x)', x: 0, y: 0, width: 320, height: 240, range: 10, centerX: 1.5, centerY: -2, tMin: 0, tMax: 6.28 },
      { id: 'g2', expression: 'y = x^2', x: 0, y: 0, width: 320, height: 240, range: 5, tMin: 0, tMax: 6.28 },
    ]

    const md = buildMathNoteMarkdown({
      title: '微积分草稿',
      results,
      variables: { x: 10 },
      graphs,
      exportedAt: '2026-11-28 12:00',
    })

    expect(md).toContain('# 微积分草稿')
    expect(md).toContain('## 已定义变量')
    expect(md).toContain('- $x = 10$')
    expect(md).toContain('x = 10')
    expect(md).toContain('\\frac{1}{3} + \\frac{1}{6} = \\frac{1}{2}')
    expect(md).toContain('> 近似值：$0.5$')
    expect(md).toContain('x^2 - 4 = 0')
    expect(md).toContain('x = -2, 2')
    expect(md).toContain('bad \\expr')
    expect(md).toContain('`y = sin(x)`（视窗中心 (1.5, -2.0)，范围 ±10）')
    expect(md).toContain('`y = x^2`（视窗中心 (0.0, 0.0)，范围 ±5）')
    expect(md).toContain('> 导出自 Kairos 手写计算 · 2026-11-28 12:00')
  })

  it('空页面输出回退标题与提示', () => {
    const md = buildMathNoteMarkdown({ title: '   ', results: [] })
    expect(md).toContain('# 手写计算笔记')
    expect(md).toContain('_本页暂无可导出的识别算式或函数图像。_')
  })
})
