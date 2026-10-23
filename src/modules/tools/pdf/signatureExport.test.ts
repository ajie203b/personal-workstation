import { describe, expect, it } from 'vitest'
import {
  PEN_BASE_PX,
  PEN_MIN_PX,
  drawStrokes,
  smoothStroke,
  strokeSegments,
  strokesBounds,
  type InkContext,
  type StrokePoint,
} from './signature'

const line = (x0: number, y0: number, x1: number, y1: number, n = 6, t0 = 0): StrokePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1), t: t0 + i * 16 }))

/** 记录调用的假 ctx：统计画了几段、几个点，以及触达的坐标范围 */
function fakeCtx() {
  const pts: { x: number; y: number }[] = []
  let strokes = 0
  let dots = 0
  const ctx: InkContext = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    beginPath() {},
    moveTo(x, y) {
      pts.push({ x, y })
    },
    quadraticCurveTo(cx, cy, x, y) {
      pts.push({ x: cx, y: cy }, { x, y })
    },
    arc(x, y) {
      pts.push({ x, y })
      dots++
    },
    stroke() {
      strokes++
    },
    fill() {},
  }
  return { ctx, pts, get strokes() { return strokes }, get dots() { return dots } }
}

describe('strokesBounds（签名裁边，v3.3.2 回归：只剩最后一笔）', () => {
  it('包围盒覆盖所有笔画，而不只是最后一笔', () => {
    const strokes = [line(20, 30, 120, 40), line(200, 100, 300, 150), line(310, 20, 330, 60)]
    const b = strokesBounds(strokes, 400, 180, 8)!
    const grow = PEN_BASE_PX / 2 + 8
    expect(b.x).toBe(Math.floor(20 - grow))
    expect(b.y).toBe(Math.floor(20 - grow))
    expect(b.x + b.width).toBe(Math.ceil(330 + grow))
    expect(b.y + b.height).toBe(Math.ceil(150 + grow))
  })

  it('贴边时夹在画板内；没有笔画返回 null', () => {
    const b = strokesBounds([line(0, 0, 400, 180)], 400, 180, 8)!
    expect(b).toEqual({ x: 0, y: 0, width: 400, height: 180 })
    expect(strokesBounds([], 400, 180)).toBeNull()
  })
})

describe('strokeSegments / drawStrokes（画什么存什么）', () => {
  it('每段带线宽，线宽在 [min, base]，段数与 smoothStroke 一致', () => {
    const pts = line(0, 0, 100, 0, 8)
    const segs = strokeSegments(pts)
    expect(segs).toHaveLength(smoothStroke(pts).length)
    for (const s of segs) {
      expect(s.width).toBeGreaterThanOrEqual(PEN_MIN_PX)
      expect(s.width).toBeLessThanOrEqual(PEN_BASE_PX)
    }
  })

  it('重绘覆盖全部笔画：每笔一个落笔点 + 全部线段，坐标都落在包围盒内', () => {
    const strokes = [line(20, 30, 120, 40, 5), line(200, 100, 300, 150, 7), [{ x: 50, y: 160, t: 0 }]]
    const f = fakeCtx()
    drawStrokes(f.ctx, strokes)
    expect(f.dots).toBe(3)
    expect(f.strokes).toBe(strokeSegments(strokes[0]).length + strokeSegments(strokes[1]).length)
    const b = strokesBounds(strokes, 400, 180)!
    for (const p of f.pts) {
      expect(p.x).toBeGreaterThanOrEqual(b.x)
      expect(p.x).toBeLessThanOrEqual(b.x + b.width)
      expect(p.y).toBeGreaterThanOrEqual(b.y)
      expect(p.y).toBeLessThanOrEqual(b.y + b.height)
    }
  })
})
