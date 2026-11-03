import { describe, expect, it } from 'vitest'
import { answerAnchor, clusterStrokes, detectTrailingEquals, estimateAnswerWidth, estimateCharHeight, fitAnswer, strokesHitBy } from './geometry'
import { rasterizeStrokes, toPixelValues, MFR_INPUT_SIZE } from './preprocess'
import { writeText } from './testInk'
import type { Stroke } from './types'

const byIds = (strokes: Stroke[], ids: string[]) => strokes.filter((s) => ids.includes(s.id))

describe('clusterStrokes', () => {
  it('横写：两行算式分成两块，按阅读顺序返回', () => {
    const line1 = writeText('12+34=', 20, 20, 40, 'a')
    const line2 = writeText('5x-3', 20, 110, 40, 'b')
    const blocks = clusterStrokes([...line2, ...line1])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].strokeIds.every((id) => id.startsWith('a'))).toBe(true)
    expect(blocks[1].strokeIds.every((id) => id.startsWith('b'))).toBe(true)
  })

  it('同一行左右离得很远的两个算式分开', () => {
    const left = writeText('1+1=', 20, 20, 40, 'l')
    const right = writeText('2+2=', 600, 20, 40, 'r')
    const blocks = clusterStrokes([...left, ...right])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].strokeIds[0].startsWith('l')).toBe(true)
  })

  it('竖写：一列从上往下写的三个算式各自成块', () => {
    const a = writeText('1+2=', 40, 20, 40, 'p')
    const b = writeText('3+4=', 40, 100, 40, 'q')
    const c = writeText('5+6=', 40, 180, 40, 'r')
    const blocks = clusterStrokes([...c, ...a, ...b])
    expect(blocks.map((bl) => bl.strokeIds[0][0])).toEqual(['p', 'q', 'r'])
  })

  it('分数：分子、分数线、分母并成一块', () => {
    const num = writeText('1', 30, 10, 40, 'n')
    const bar: Stroke = { id: 'bar', width: 3, points: [{ x: 15, y: 60, p: 0.5, t: 0 }, { x: 75, y: 60, p: 0.5, t: 1 }] }
    const den = writeText('3', 30, 68, 40, 'd')
    const blocks = clusterStrokes([...num, bar, ...den], { charHeight: 40 })
    expect(blocks).toHaveLength(1)
  })

  it('笔画不变时块的 key 稳定', () => {
    const s = writeText('7+8=', 0, 0, 40, 'k')
    expect(clusterStrokes(s)[0].key).toBe(clusterStrokes([...s].reverse())[0].key)
  })
})

describe('detectTrailingEquals / answerAnchor', () => {
  it('以等号结尾时检测到等号，答案紧贴等号右侧、与等号中线对齐', () => {
    const strokes = writeText('12+34=', 20, 20, 40)
    const h = estimateCharHeight(strokes)
    const eq = detectTrailingEquals(strokes, h)
    expect(eq).not.toBeNull()
    // 第 6 个字符位置：x 从 20 + 5×32 = 180 起，等号横线 0.05~0.55 → 182~202
    expect(eq!.box.minX).toBeCloseTo(182, 0)
    expect(eq!.box.maxX).toBeCloseTo(202, 0)
    const [block] = clusterStrokes(strokes)
    const anchor = answerAnchor(block, eq, h)
    expect(anchor.placement).toBe('inline')
    expect(anchor.x).toBeGreaterThan(eq!.box.maxX)
    expect(anchor.y).toBeCloseTo(20 + 0.575 * 40, 0)
  })

  it('等号不在最后（方程）时不算尾部等号', () => {
    const strokes = writeText('2x+3=7', 20, 20, 40)
    expect(detectTrailingEquals(strokes, estimateCharHeight(strokes))).toBeNull()
  })

  it('只有减号、没有等号时不触发', () => {
    const strokes = writeText('9-4', 20, 20, 40)
    expect(detectTrailingEquals(strokes, estimateCharHeight(strokes))).toBeNull()
  })

  it('没有等号时答案放在块下方', () => {
    const strokes = writeText('x+1=0', 20, 20, 40)
    const [block] = clusterStrokes(strokes)
    const a = answerAnchor(block, null, 40)
    expect(a.placement).toBe('below')
    expect(a.y).toBeGreaterThan(block.box.maxY)
  })
})

describe('strokesHitBy', () => {
  it('橡皮只擦到经过的笔画', () => {
    const strokes = writeText('1+', 0, 0, 40, 'e')
    const plusVertical = strokes[2]
    const hit = strokesHitBy(strokes, 32 + 0.3 * 40, 0.55 * 40 + 6, 3)
    expect(hit).toContain(plusVertical.id)
    expect(hit).not.toContain(strokes[0].id)
  })
})

describe('preprocess', () => {
  it('栅格化为白底黑字，送模型张量为 [-1,1]、3×384×384', () => {
    const strokes = writeText('1+2=', 100, 300, 60)
    const img = rasterizeStrokes(strokes, estimateCharHeight(strokes))
    expect(img.width).toBeGreaterThan(img.height)
    const dark = img.data.filter((v) => v < 128).length
    expect(dark).toBeGreaterThan(0)
    expect(dark / img.data.length).toBeLessThan(0.3)
    expect(img.data[0]).toBe(255)
    const t = toPixelValues(img)
    expect(t.length).toBe(3 * MFR_INPUT_SIZE * MFR_INPUT_SIZE)
    expect(t[0]).toBeCloseTo(1)
    let min = Infinity
    for (const v of t) if (v < min) min = v
    expect(min).toBeLessThan(0)
  })
  it('只有一笔也能处理', () => {
    expect(byIds(writeText('1', 0, 0), []).length).toBe(0)
    const img = rasterizeStrokes(writeText('1', 0, 0), 40)
    expect(img.width).toBeGreaterThan(8)
  })
})

describe('fitAnswer（答案不被画布右边界裁掉，回归）', () => {
  // 等号在 x≈182~202，答案默认从 ~214 开始
  const setup = (ox = 20) => {
    const strokes = writeText('12+34=', ox, 20, 40)
    const h = estimateCharHeight(strokes)
    const eq = detectTrailingEquals(strokes, h)!
    const [block] = clusterStrokes(strokes)
    return { h, eq, block }
  }
  const inside = (a: { x: number; maxWidth?: number }, w: number, view: number) => {
    expect(a.x).toBeGreaterThanOrEqual(0)
    expect(a.x + Math.min(w, a.maxWidth ?? w)).toBeLessThanOrEqual(view)
  }

  it('右侧放得下：仍写在等号后', () => {
    const { h, eq, block } = setup()
    const a = fitAnswer(block, eq, h, { answerWidth: 60, viewWidth: 400 })
    expect(a.placement).toBe('inline')
    expect(a.wrapped).toBe(false)
    expect(a.x).toBeCloseTo(answerAnchor(block, eq, h).x, 5)
    inside(a, 60, 400)
  })

  it('右侧放不下：改到算式下方、左对齐算式，完全可见', () => {
    const { h, eq, block } = setup()
    const a = fitAnswer(block, eq, h, { answerWidth: 150, viewWidth: 320 })
    expect(a.placement).toBe('below')
    expect(a.wrapped).toBe(true)
    expect(a.x).toBe(block.box.minX)
    expect(a.y - a.fontSize / 2).toBeGreaterThan(block.box.maxY)
    inside(a, 150, 320)
  })

  it('算式本身靠右：下方答案整体左移贴住右边界', () => {
    const { h, eq, block } = setup(150)
    const a = fitAnswer(block, eq, h, { answerWidth: 250, viewWidth: 380, margin: 8 })
    expect(a.placement).toBe('below')
    expect(a.x).toBe(380 - 8 - 250)
    inside(a, 250, 380)
  })

  it('比可视宽度还宽：贴左边界并限宽（答案自身横向滚动）', () => {
    const { h, eq, block } = setup()
    const a = fitAnswer(block, eq, h, { answerWidth: 900, viewWidth: 360, margin: 8 })
    expect(a.x).toBe(8)
    expect(a.maxWidth).toBe(344)
    inside(a, 900, 360)
  })

  it('本来就放下方的结果（解方程）超出右边界时也收回来', () => {
    const strokes = writeText('x+1=0', 200, 20, 40)
    const h = estimateCharHeight(strokes)
    const [block] = clusterStrokes(strokes)
    const a = fitAnswer(block, null, h, { answerWidth: 200, viewWidth: 320 })
    expect(a.placement).toBe('below')
    expect(a.wrapped).toBe(false)
    inside(a, 200, 320)
  })

  it('视口宽度未知时不调整', () => {
    const { h, eq, block } = setup()
    expect(fitAnswer(block, eq, h, { answerWidth: 900, viewWidth: 0 }).placement).toBe('inline')
  })

  it('estimateAnswerWidth 随字数与近似值增长', () => {
    expect(estimateAnswerWidth('46', 40)).toBeLessThan(estimateAnswerWidth('123456789', 40))
    expect(estimateAnswerWidth('1/3', 40, '0.3333333333')).toBeGreaterThan(estimateAnswerWidth('1/3', 40))
  })
})
