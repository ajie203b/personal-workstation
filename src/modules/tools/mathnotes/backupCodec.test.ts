import { describe, expect, it } from 'vitest'
import { packMathNote, packStroke, unpackMathNote, unpackStroke } from './backupCodec'
import type { MathNotePage, Stroke } from './types'

const stroke: Stroke = {
  id: 's1',
  width: 3,
  points: [
    { x: 12.34, y: 56.78, p: 0.513, t: 1730000000000.4 },
    { x: 13, y: 57.06, p: 0.6, t: 1730000000016 },
    { x: -2.25, y: 0, p: 1, t: 1730000000100 },
  ],
}

describe('backupCodec', () => {
  it('打包再解包：点数不变，坐标误差 ≤0.05px，时间精确到毫秒', () => {
    const back = unpackStroke(packStroke(stroke))
    expect(back.id).toBe('s1')
    expect(back.width).toBe(3)
    expect(back.points).toHaveLength(3)
    stroke.points.forEach((p, i) => {
      expect(Math.abs(back.points[i].x - p.x)).toBeLessThanOrEqual(0.0501)
      expect(Math.abs(back.points[i].y - p.y)).toBeLessThanOrEqual(0.0501)
      expect(back.points[i].t).toBe(Math.round(p.t))
    })
  })

  it('空笔画与空页不出错', () => {
    expect(unpackStroke(packStroke({ id: 'e', width: 2, points: [] })).points).toEqual([])
    const page: MathNotePage = { id: 'p', title: '空', strokes: [], results: [], createdAt: 1, updatedAt: 2 }
    expect(unpackMathNote(packMathNote(page))).toEqual(page)
  })

  it('未编码的原始行（手改备份）原样收下', () => {
    const page: MathNotePage = { id: 'p', title: '原始', strokes: [stroke], results: [], createdAt: 1, updatedAt: 2 }
    expect(unpackMathNote(page)).toEqual(page)
  })

  it('打包结果里不再有 enc 之外的多余字段，解包后 enc 被去掉', () => {
    const page: MathNotePage = { id: 'p', title: 't', strokes: [stroke], results: [], createdAt: 1, updatedAt: 2 }
    const packed = packMathNote(page)
    expect(packed.enc).toBe(1)
    expect('enc' in unpackMathNote(packed)).toBe(false)
  })
})


it('插入的图像配置随笔记备份并恢复', () => {
  const graphs = [{ id: 'g', expression: 'y=a*x', sourceKey: 'a|b', x: 20, y: 80, width: 280, height: 220, range: 10, centerX: 3, centerY: -2, hiddenCurves: [1], tMin: 0, tMax: 6.28 }]
  const page = { id: 'p', title: '笔记', strokes: [], results: [], graphs, createdAt: 1, updatedAt: 2 }
  expect(unpackMathNote(packMathNote(page)).graphs).toEqual(graphs)
})
