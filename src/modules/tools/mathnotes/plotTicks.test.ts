import { describe, expect, it } from 'vitest'
import { computeAxisTicks, computeNiceStep } from './plotTicks'
import { normalizeLatex } from './latexNormalize'
import { rasterizeStrokes } from './preprocess'

describe('plotTicks 自适应坐标系刻度', () => {
  it('按 1 / 2 / 5 × 10^k 选取整洁步长并生成带零点标记的刻度', () => {
    expect(computeNiceStep(20, 6)).toBe(5)
    expect(computeNiceStep(10, 5)).toBe(2)
    expect(computeNiceStep(2, 6)).toBeCloseTo(0.5, 6)

    const ticks = computeAxisTicks(0, 10, 'x', 6)
    expect(ticks.map((t) => t.label)).toEqual(['-10', '-5', '0', '5', '10'])
    expect(ticks.find((t) => t.isZero)?.pos).toBe(200)
  })
})

describe('手写识别前处理与后处理增强', () => {
  it('纠正手写常见的幂次乘号、小写 o/l、surd、尾随全等与杂散标点', () => {
    expect(normalizeLatex('2\\times^2+3\\times=')).toBe('2x^2+3x=')
    expect(normalizeLatex('1o+2l=')).toBe('10+21=')
    expect(normalizeLatex('\\surd{9}\\equiv')).toBe('\\sqrt{9}=')
    expect(normalizeLatex('12+34=,')).toBe('12+34=')
    expect(normalizeLatex('3\\ldotp 14+1=')).toBe('3.14+1=')
  })

  it('超宽单行算式栅格化时自动补齐纵向留白以防 384 缩放压扁竖笔', () => {
    const strokes = [
      {
        id: 'wide',
        width: 2.6,
        points: [
          { x: 0, y: 20, p: 0.5, t: 0 },
          { x: 600, y: 24, p: 0.5, t: 10 },
          { x: 1200, y: 20, p: 0.5, t: 20 },
        ],
      },
    ]
    const img = rasterizeStrokes(strokes, 40)
    expect(img.width).toBeGreaterThan(800)
    // 原高度仅 ~4px + 留白，增强后至少保留充足纵向留白防止极端扁平拉伸
    expect(img.height).toBeGreaterThanOrEqual(80)
  })
})
