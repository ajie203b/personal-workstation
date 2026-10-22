/**
 * 裁剪框计算测试：关键点 → 矩形（含边界夹紧）、手动微调、兜底框。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CROP_PARAMS,
  computeCropBox,
  cropGuides,
  facePointsFromNormalized,
  fallbackCropBox,
  fitAndClamp,
} from './idphotoCrop'

const ASPECT = 295 / 413 // 一寸

describe('fitAndClamp', () => {
  it('框在图内时原样返回', () => {
    const box = fitAndClamp({ x: 10, y: 20, width: 100, height: 200 }, 500, 600)
    expect(box).toEqual({ x: 10, y: 20, width: 100, height: 200 })
  })

  it('左/上出界时贴到 0', () => {
    const box = fitAndClamp({ x: -50, y: -30, width: 100, height: 200 }, 500, 600)
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
    expect(box.width).toBe(100)
    expect(box.height).toBe(200)
  })

  it('右/下出界时贴到图边', () => {
    const box = fitAndClamp({ x: 480, y: 500, width: 100, height: 200 }, 500, 600)
    expect(box.x).toBe(400)
    expect(box.y).toBe(400)
    expect(box.width).toBe(100)
    expect(box.height).toBe(200)
  })

  it('框比图大时等比缩到图内并居中', () => {
    const box = fitAndClamp({ x: 0, y: 0, width: 1000, height: 500 }, 400, 400)
    expect(box.width).toBeCloseTo(400, 5)
    expect(box.height).toBeCloseTo(200, 5)
    expect(box.x).toBeCloseTo(0, 5)
    expect(box.y).toBeCloseTo(150, 5)
  })

  it('非法尺寸退化成整图，不产生负宽高', () => {
    const box = fitAndClamp({ x: 5, y: 5, width: 0, height: -3 }, 300, 200)
    expect(box.width).toBe(300)
    expect(box.height).toBe(200)
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
  })
})

describe('computeCropBox', () => {
  // 图 1000×1500，双眼 (400,500)/(600,500)：眼距 200，眼高 500
  const points = { leftEye: { x: 400, y: 500 }, rightEye: { x: 600, y: 500 } }

  it('按头高占比与头顶留白定框（无下巴/头顶关键点时用眼距推算）', () => {
    const box = computeCropBox(points, 1000, 1500, ASPECT, { headRatio: 0.7, headroom: 0.1 })
    const d = 200
    const chinY = 500 + d // 眼→下巴 = 1.0d
    const topY = 500 - d * 1.15 // 眼→头顶 = 1.15d
    const headH = chinY - topY // 430
    const boxH = headH / 0.7
    const boxW = boxH * ASPECT
    expect(box.height).toBeCloseTo(boxH, 1)
    expect(box.width).toBeCloseTo(boxW, 1)
    // 顶部 = 头顶 - 留白
    expect(box.y).toBeCloseTo(topY - boxH * 0.1, 1)
    // 水平居中在两眼中点
    expect(box.x).toBeCloseTo(500 - boxW / 2, 1)
  })

  it('给出下巴/头顶关键点时直接用实测头高', () => {
    const box = computeCropBox(
      { ...points, chin: { x: 500, y: 800 }, top: { x: 500, y: 300 } },
      1000,
      1500,
      ASPECT,
      { headRatio: 0.5, headroom: 0 },
    )
    // 头高 500，占比 0.5 → 框高 1000，顶对齐头顶
    expect(box.height).toBeCloseTo(1000, 1)
    expect(box.y).toBeCloseTo(300, 1)
  })

  it('框宽于图时被夹到左边界（含边界）', () => {
    const box = computeCropBox(
      { leftEye: { x: 10, y: 500 }, rightEye: { x: 210, y: 500 } },
      1000,
      1500,
      1, // 正方形框更容易顶到边界
      { headRatio: 0.5, headroom: 0 },
    )
    expect(box.x).toBe(0)
    expect(box.x + box.width).toBeLessThanOrEqual(1000)
  })

  it('人贴近右下角时框贴到右/下边界且不出图', () => {
    const box = computeCropBox(
      { leftEye: { x: 900, y: 1400 }, rightEye: { x: 980, y: 1400 } },
      1000,
      1500,
      ASPECT,
    )
    expect(box.x + box.width).toBeCloseTo(1000, 1)
    expect(box.y + box.height).toBeCloseTo(1500, 1)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
  })

  it('手动偏移与缩放生效', () => {
    const auto = computeCropBox(points, 1000, 1500, ASPECT, {})
    const moved = computeCropBox(points, 1000, 1500, ASPECT, { offsetX: 0.1, offsetY: -0.1, zoom: 1.2 })
    expect(moved.width).toBeCloseTo(auto.width * 1.2, 1)
    expect(moved.height).toBeCloseTo(auto.height * 1.2, 1)
  })

  it('极端参数下也不出 NaN', () => {
    const box = computeCropBox(points, 1000, 1500, ASPECT, {
      headRatio: 0,
      zoom: Number.NaN,
      offsetX: Number.POSITIVE_INFINITY,
    })
    for (const v of [box.x, box.y, box.width, box.height]) expect(Number.isFinite(v)).toBe(true)
  })

  it('默认参数来自 DEFAULT_CROP_PARAMS', () => {
    const a = computeCropBox(points, 1000, 1500, ASPECT)
    const b = computeCropBox(points, 1000, 1500, ASPECT, DEFAULT_CROP_PARAMS)
    expect(a).toEqual(b)
  })
})

describe('fallbackCropBox', () => {
  it('竖图取最大内接框（全宽、垂直居中）', () => {
    const box = fallbackCropBox(1000, 1500, ASPECT)
    expect(box.width).toBeCloseTo(1000, 5)
    expect(box.height).toBeCloseTo(1000 / ASPECT, 5)
    expect(box.x).toBeCloseTo(0, 5)
    expect(box.y).toBeCloseTo((1500 - 1000 / ASPECT) / 2, 5)
  })

  it('横图取全高、水平居中', () => {
    const box = fallbackCropBox(2000, 1000, ASPECT)
    expect(box.height).toBeCloseTo(1000, 5)
    expect(box.width).toBeCloseTo(1000 * ASPECT, 5)
    expect(box.x).toBeCloseTo((2000 - 1000 * ASPECT) / 2, 5)
    expect(box.y).toBeCloseTo(0, 5)
  })
})

describe('facePointsFromNormalized', () => {
  it('归一化关键点换算像素坐标，嘴中精修下巴', () => {
    // 顺序：右眼、左眼、鼻尖、嘴中
    const pts = facePointsFromNormalized(
      [
        { x: 0.3, y: 0.4 },
        { x: 0.5, y: 0.4 },
        { x: 0.4, y: 0.45 },
        { x: 0.4, y: 0.5 },
      ],
      1000,
      1000,
    )
    expect(pts.rightEye).toEqual({ x: 300, y: 400 })
    expect(pts.leftEye).toEqual({ x: 500, y: 400 })
    // 眼高 400，嘴 500 → 下巴 = 500 + (500-400)*0.6 = 560
    expect(pts.chin?.y).toBeCloseTo(560, 5)
  })

  it('只有两个关键点也能用（下巴靠眼距推算）', () => {
    const pts = facePointsFromNormalized(
      [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.3 },
      ],
      100,
      100,
    )
    expect(pts.leftEye).toEqual({ x: 40, y: 30 })
    expect(pts.chin).toBeUndefined()
  })
})

describe('cropGuides', () => {
  it('眼线约在 0.42、三等分线均分框高', () => {
    const g = cropGuides({ x: 0, y: 0, width: 300, height: 400 })
    expect(g.eyeLineY).toBeCloseTo(168, 5)
    expect(g.thirdLinesY[0]).toBeCloseTo(400 / 3, 5)
    expect(g.thirdLinesY[1]).toBeCloseTo(800 / 3, 5)
  })
})
