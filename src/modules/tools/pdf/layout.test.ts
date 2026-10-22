import { describe, expect, it } from 'vitest'
import {
  A4,
  centerRect,
  cornerRects,
  imagePageLayout,
  normRotation,
  pageInfo,
  pageNumberRect,
  placementRect,
  tileRects,
  visualRectToDraw,
  type VisualRect,
} from './layout'

/** 媒体坐标 → 视觉坐标（与 visualRectToDraw 的锚点公式配套，用于四角对拍） */
function mediaToVisual(mw: number, mh: number, r: number, x: number, y: number) {
  switch (r) {
    case 90:
      return { x: y, y: x }
    case 180:
      return { x: mw - x, y }
    case 270:
      return { x: mh - y, y: mw - x }
    default:
      return { x, y: mh - y }
  }
}

/** 图片空间点 → 媒体空间：锚点 + 逆时针 rotate */
function rotPoint(x: number, y: number, u: number, v: number, rotate: number) {
  switch (rotate) {
    case 90:
      return { x: x - v, y: y + u }
    case 180:
      return { x: x - u, y: y - v }
    case 270:
      return { x: x + v, y: y - u }
    default:
      return { x: x + u, y: y + v }
  }
}

/** 把 drawImage 参数里的图片四角换算回视觉坐标，应与目标矩形四角重合 */
function imageCornersInVisual(
  mediaW: number,
  mediaH: number,
  rotation: number,
  d: { x: number; y: number; width: number; height: number; rotate: number },
) {
  const { x, y, width: w, height: h, rotate } = d
  const raw = [
    { name: 'BL', u: 0, v: 0 },
    { name: 'BR', u: w, v: 0 },
    { name: 'TR', u: w, v: h },
    { name: 'TL', u: 0, v: h },
  ].map(({ name, u, v }) => {
    const m = rotPoint(x, y, u, v, rotate)
    return { name, ...mediaToVisual(mediaW, mediaH, rotation, m.x, m.y) }
  })
  return raw
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

describe('normRotation / pageInfo', () => {
  it('归一到四档，兼容负角与超一圈', () => {
    expect(normRotation(0)).toBe(0)
    expect(normRotation(360)).toBe(0)
    expect(normRotation(-90)).toBe(270)
    expect(normRotation(450)).toBe(90)
    expect(normRotation(30)).toBe(0)
    expect(normRotation(89)).toBe(90)
  })

  it('旋转 90/270 时视觉宽高互换', () => {
    const p = pageInfo(200, 300, 90)
    expect(p.visW).toBe(300)
    expect(p.visH).toBe(200)
    const q = pageInfo(200, 300, 180)
    expect(q.visW).toBe(200)
    expect(q.visH).toBe(300)
  })
})

describe('visualRectToDraw（四角对拍）', () => {
  const cases: { mediaW: number; mediaH: number; rotation: number; rect: VisualRect }[] = [
    { mediaW: 200, mediaH: 300, rotation: 0, rect: { x: 10, y: 20, w: 50, h: 30 } },
    { mediaW: 200, mediaH: 300, rotation: 90, rect: { x: 5, y: 8, w: 40, h: 20 } },
    { mediaW: 200, mediaH: 300, rotation: 180, rect: { x: 1, y: 2, w: 100, h: 90 } },
    { mediaW: 200, mediaH: 300, rotation: 270, rect: { x: 30, y: 40, w: 60, h: 15 } },
  ]
  for (const c of cases) {
    it(`旋转 ${c.rotation}° 时图片四角落在视觉矩形四角`, () => {
      const info = pageInfo(c.mediaW, c.mediaH, c.rotation)
      const d = visualRectToDraw(info, c.rect)
      expect(d.rotate).toBe(c.rotation)
      expect(d.width).toBe(c.rect.w)
      expect(d.height).toBe(c.rect.h)
      const corners = imageCornersInVisual(c.mediaW, c.mediaH, c.rotation, d)
      const byName = Object.fromEntries(corners.map((k) => [k.name, k]))
      // 图片自身 BL 在视觉上是矩形左下角（y 向下）
      expect(near(byName.BL.x, c.rect.x) && near(byName.BL.y, c.rect.y + c.rect.h)).toBe(true)
      expect(near(byName.BR.x, c.rect.x + c.rect.w) && near(byName.BR.y, c.rect.y + c.rect.h)).toBe(true)
      expect(near(byName.TR.x, c.rect.x + c.rect.w) && near(byName.TR.y, c.rect.y)).toBe(true)
      expect(near(byName.TL.x, c.rect.x) && near(byName.TL.y, c.rect.y)).toBe(true)
    })
  }
})

describe('水印 / 页码布局', () => {
  it('平铺覆盖页面且不越界', () => {
    const rects = tileRects(595, 842, 120, 60)
    expect(rects.length).toBeGreaterThan(1)
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.001)
      expect(r.y).toBeGreaterThanOrEqual(-0.001)
      expect(r.x + r.w).toBeLessThanOrEqual(595.001)
      expect(r.y + r.h).toBeLessThanOrEqual(842.001)
    }
  })

  it('居中 / 四角 / 页码矩形', () => {
    const c = centerRect(595, 842, 100, 40)
    expect(c).toEqual({ x: (595 - 100) / 2, y: (842 - 40) / 2, w: 100, h: 40 })
    const corners = cornerRects(595, 842, 100, 40, 10)
    expect(corners).toHaveLength(4)
    expect(corners[0]).toEqual({ x: 10, y: 10, w: 100, h: 40 })
    expect(corners[3]).toEqual({ x: 595 - 10 - 100, y: 842 - 10 - 40, w: 100, h: 40 })
    const pn = pageNumberRect(595, 842, 60, 20, 'center', 20)
    expect(pn.x).toBe((595 - 60) / 2)
    expect(pn.y).toBe(842 - 20 - 20)
  })
})

describe('imagePageLayout', () => {
  it('a4：固定 A4、等比缩放进边距内', () => {
    const l = imagePageLayout(400, 300, { size: 'a4', margin: 20 })
    expect(l.pageW).toBe(A4.w)
    expect(l.pageH).toBe(A4.h)
    expect(l.rect.w).toBeLessThanOrEqual(A4.w - 40 + 0.001)
    expect(l.rect.h).toBeLessThanOrEqual(A4.h - 40 + 0.001)
    // 宽图受宽度约束
    expect(l.rect.w).toBeCloseTo(A4.w - 40, 3)
  })

  it('native：页面 = 图 + 双倍边距', () => {
    const l = imagePageLayout(400, 300, { size: 'native', margin: 12 })
    expect(l.pageW).toBe(424)
    expect(l.pageH).toBe(324)
    expect(l.rect).toEqual({ x: 12, y: 12, w: 400, h: 300 })
  })

  it('fit：页宽 = A4 宽，长图页高自适应', () => {
    const l = imagePageLayout(300, 900, { size: 'fit', margin: 20 })
    expect(l.pageW).toBe(A4.w)
    expect(l.rect.w).toBeCloseTo(A4.w - 40, 3)
    expect(l.rect.h / l.rect.w).toBeCloseTo(3, 3)
    expect(l.pageH).toBeCloseTo(l.rect.h + 40, 3)
  })
})

describe('placementRect', () => {
  it('按页宽比例算高，并夹回页内', () => {
    const r = placementRect(500, 700, 200, 100, { nx: 0.5, ny: 0.5, nw: 0.4 })
    expect(r.w).toBe(200)
    expect(r.h).toBe(100)
    expect(r.x).toBe(250 - 100)
    expect(r.y).toBe(350 - 50)
    const edge = placementRect(500, 700, 200, 100, { nx: 1, ny: 1, nw: 0.4 })
    expect(edge.x + edge.w).toBeLessThanOrEqual(500)
    expect(edge.y + edge.h).toBeLessThanOrEqual(700)
  })
})
