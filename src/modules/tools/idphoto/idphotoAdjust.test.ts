import { describe, expect, it } from 'vitest'
import {
  applyManualAdjust,
  computeCropBox,
  eyeLineAngle,
  fallbackCropBox,
  levelingRotation,
  rotateFacePoints,
  type FacePoints,
} from './idphotoCrop'
import { planFaceSearchWindows, windowToImageNormalized } from './idphotoFaceSearch'
import { applyMatrix, orientationTransform, readJpegOrientation, resetJpegOrientation } from './idphotoExif'

const ASPECT = 295 / 413

describe('applyManualAdjust（滑杆微调，v3.3.3 回归）', () => {
  it('没检测到人脸的兜底框也响应左右/上下/缩放', () => {
    // 竖图兜底框 = 全宽最大内接框；旧版滑杆对它完全无效
    const base = fallbackCropBox(1200, 1600, ASPECT)
    const moved = applyManualAdjust(base, { offsetX: -0.3, offsetY: 0.3, zoom: 1.47 }, 1200, 1600)
    expect(moved).not.toEqual(base)
    expect(moved.height).toBeCloseTo(base.height * 1.47, 3)
    expect(moved.width / moved.height).toBeCloseTo(ASPECT, 5)
    // 中心向左、向下移动
    expect(moved.x + moved.width / 2).toBeLessThan(base.x + base.width / 2)
    expect(moved.y + moved.height / 2).toBeGreaterThan(base.y + base.height / 2)
  })

  it('人脸框已贴边时，偏移/放大仍然有可见变化（允许超出原图）', () => {
    const pts: FacePoints = { leftEye: { x: 40, y: 300 }, rightEye: { x: 140, y: 300 } }
    const base = computeCropBox(pts, 1000, 1500, ASPECT)
    expect(base.x).toBe(0) // 贴左边
    const left = applyManualAdjust(base, { offsetX: -0.2 }, 1000, 1500)
    expect(left.x).toBeLessThan(base.x)
    const zoomed = applyManualAdjust(base, { zoom: 1.4 }, 1000, 1500)
    expect(zoomed.width).toBeGreaterThan(base.width)
  })

  it('全默认 = 原框；非法值不出 NaN，中心夹在图内', () => {
    const base = { x: 100, y: 100, width: 300, height: 420 }
    expect(applyManualAdjust(base, { offsetX: 0, offsetY: 0, zoom: 1 }, 1000, 1000)).toEqual(base)
    const weird = applyManualAdjust(base, { offsetX: Number.NaN, zoom: Number.POSITIVE_INFINITY }, 1000, 1000)
    for (const v of Object.values(weird)) expect(Number.isFinite(v)).toBe(true)
    const far = applyManualAdjust(base, { offsetX: 0.5, offsetY: 0.5, zoom: 2 }, 400, 400)
    expect(far.x + far.width / 2).toBeLessThanOrEqual(400)
    expect(far.y + far.height / 2).toBeLessThanOrEqual(400)
  })
})

describe('眼睛扶正', () => {
  it('眼线角度与扶正旋转：右眼低 10° → 旋转 -10° 后两眼水平', () => {
    const a = (10 * Math.PI) / 180
    const pts: FacePoints = {
      leftEye: { x: 100, y: 100 },
      rightEye: { x: 100 + 80 * Math.cos(a), y: 100 + 80 * Math.sin(a) },
      chin: { x: 120, y: 200 },
    }
    expect(eyeLineAngle(pts)).toBeCloseTo(a, 6)
    const rot = levelingRotation(pts)
    expect(rot).toBeCloseTo(-a, 6)
    const cx = (pts.leftEye.x + pts.rightEye.x) / 2
    const cy = (pts.leftEye.y + pts.rightEye.y) / 2
    const r = rotateFacePoints(pts, rot, cx, cy)
    expect(r.leftEye.y).toBeCloseTo(r.rightEye.y, 6)
    expect(r.chin).toBeDefined()
  })

  it('左右眼顺序对调结果一样；<1° 与 >30° 不转', () => {
    const pts: FacePoints = { leftEye: { x: 200, y: 110 }, rightEye: { x: 100, y: 100 } }
    expect(levelingRotation(pts)).toBeCloseTo(-Math.atan2(10, 100), 6)
    expect(levelingRotation({ leftEye: { x: 0, y: 0 }, rightEye: { x: 100, y: 1 } })).toBe(0)
    expect(levelingRotation({ leftEye: { x: 0, y: 0 }, rightEye: { x: 100, y: 80 } })).toBe(0)
  })
})

describe('人脸多窗口搜索', () => {
  it('窗口都在图内、数量封顶、优先中上部', () => {
    const wins = planFaceSearchWindows(1200, 1600)
    expect(wins.length).toBeGreaterThan(3)
    expect(wins.length).toBeLessThanOrEqual(24)
    for (const w of wins) {
      expect(w.x).toBeGreaterThanOrEqual(0)
      expect(w.y).toBeGreaterThanOrEqual(0)
      expect(w.x + w.size).toBeLessThanOrEqual(1200)
      expect(w.y + w.size).toBeLessThanOrEqual(1600)
    }
    // 第一个窗口（最大一级里最靠近中上部的）中心在上半部分
    expect(wins[0].y + wins[0].size / 2).toBeLessThan(1600 * 0.6)
  })

  it('窗口内归一化坐标正确映射回整图', () => {
    const p = windowToImageNormalized({ x: 0.5, y: 0.5 }, { x: 100, y: 200, size: 400 }, 1000, 2000)
    expect(p.x).toBeCloseTo(0.3, 6)
    expect(p.y).toBeCloseTo(0.2, 6)
  })
})

/** 构造一个最小 JPEG：SOI + APP1(Exif, IFD0 只有 Orientation) + EOI */
function jpegWithOrientation(o: number, littleEndian: boolean): Uint8Array {
  const tiff: number[] = littleEndian
    ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, o, 0x00, 0x00, 0x00, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, 0, 0, 0, 0]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = payload.length + 2
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xd9])
}

describe('EXIF 方向', () => {
  it('大小端都能读出 Orientation，改写成 1 不动原数组', () => {
    for (const le of [true, false]) {
      const jpg = jpegWithOrientation(6, le)
      const info = readJpegOrientation(jpg)
      expect(info?.orientation).toBe(6)
      const reset = resetJpegOrientation(jpg, info!)
      expect(readJpegOrientation(reset)?.orientation).toBe(1)
      expect(readJpegOrientation(jpg)?.orientation).toBe(6)
    }
  })

  it('非 JPEG / 无 EXIF 返回 null', () => {
    expect(readJpegOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })

  it('8 种方向的变换矩阵把原图四角映射到输出画布四角', () => {
    const W = 40
    const H = 30
    for (let o = 1; o <= 8; o++) {
      const t = orientationTransform(o, W, H)
      expect([t.width, t.height]).toEqual(o >= 5 ? [H, W] : [W, H])
      const corners = [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ].map(([x, y]) => applyMatrix(t.matrix, x, y))
      const xs = corners.map((c) => Math.round(c.x)).sort((a, b) => a - b)
      const ys = corners.map((c) => Math.round(c.y)).sort((a, b) => a - b)
      expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([0, t.width, 0, t.height])
    }
    // 方向 6（手机竖拍最常见）：原图左上角 → 输出右上角
    const t6 = orientationTransform(6, W, H)
    expect(applyMatrix(t6.matrix, 0, 0)).toEqual({ x: H, y: 0 })
  })
})
