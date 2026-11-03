/**
 * 识别前处理（纯 JS，不依赖 canvas，Worker / 单测里都能跑）：
 * 1. 把一个算式块的笔画栅格化成「白底黑字」灰度图：按字高统一缩放
 *    （字高 → RASTER_CHAR_PX），四周留白，笔宽固定，与印刷体训练图的笔画粗细接近；
 * 2. 按 Pix2Text MFR 1.5 的 preprocessor_config.json 送进模型：
 *    DeiTImageProcessor，do_resize 到 384×384（直接拉伸，不保持宽高比、不居中裁剪），
 *    rescale 1/255，normalize mean=std=0.5 → 值域 [-1, 1]，RGB 三通道相同，NCHW。
 *    官方 resample=3（bicubic）；这里缩小用面积平均、放大用双线性，差异只在亚像素级。
 */
import { boxH, boxW, strokeBox, unionBox, EMPTY_BOX } from './geometry'
import type { Stroke } from './types'

export const MFR_INPUT_SIZE = 384
/** 栅格化时把字高统一缩放到多少像素 */
export const RASTER_CHAR_PX = 48
/** 栅格化笔宽（像素） */
export const RASTER_LINE_PX = 4
/** 栅格图最长边上限，防止一整行长算式吃太多内存 */
const MAX_RASTER_SIDE = 4096

export interface GrayImage {
  /** 0=黑 255=白 */
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 笔画 → 白底黑字灰度图 */
export function rasterizeStrokes(strokes: Stroke[], charHeight: number): GrayImage {
  let box = EMPTY_BOX
  for (const s of strokes) if (s.points.length) box = unionBox(box, strokeBox(s))
  if (!Number.isFinite(box.minX)) return { data: new Uint8ClampedArray([255]), width: 1, height: 1 }

  let scale = RASTER_CHAR_PX / Math.max(1, charHeight)
  const pad = RASTER_CHAR_PX * 0.3
  const rawW = boxW(box) * scale + pad * 2
  const rawH = boxH(box) * scale + pad * 2
  const shrink = Math.min(1, MAX_RASTER_SIDE / Math.max(rawW, rawH))
  scale *= shrink
  const padS = pad * shrink
  const width = Math.max(8, Math.ceil(boxW(box) * scale + padS * 2))
  const height = Math.max(8, Math.ceil(boxH(box) * scale + padS * 2))
  // ink 是覆盖率 0~1，最后再转灰度
  const ink = new Float32Array(width * height)
  const r = Math.max(1, (RASTER_LINE_PX * Math.max(0.5, shrink)) / 2)
  const tx = (x: number) => (x - box.minX) * scale + padS
  const ty = (y: number) => (y - box.minY) * scale + padS

  const stampSegment = (x0: number, y0: number, x1: number, y1: number) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r + 1))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r + 1))
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5
        const cy = py + 0.5
        let t = len2 ? ((cx - x0) * dx + (cy - y0) * dy) / len2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const d = Math.hypot(cx - (x0 + t * dx), cy - (y0 + t * dy))
        const cov = r + 0.5 - d
        if (cov <= 0) continue
        const i = py * width + px
        const v = cov >= 1 ? 1 : cov
        if (v > ink[i]) ink[i] = v
      }
    }
  }

  for (const s of strokes) {
    const pts = s.points
    if (!pts.length) continue
    if (pts.length === 1) {
      stampSegment(tx(pts[0].x), ty(pts[0].y), tx(pts[0].x), ty(pts[0].y))
      continue
    }
    for (let i = 1; i < pts.length; i++) {
      stampSegment(tx(pts[i - 1].x), ty(pts[i - 1].y), tx(pts[i].x), ty(pts[i].y))
    }
  }

  const data = new Uint8ClampedArray(width * height)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(255 * (1 - ink[i]))
  return { data, width, height }
}

/** 灰度图缩放：缩小走面积平均（不丢细笔画），放大走双线性 */
export function resizeGray(src: GrayImage, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh)
  const { data, width: sw, height: sh } = src
  const sx = sw / dw
  const sy = sh / dh
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let v: number
      if (sx > 1 || sy > 1) {
        // 面积平均：源图中 [x*sx, (x+1)*sx) × [y*sy, (y+1)*sy) 的均值（按整像素近似）
        const x0 = Math.floor(x * sx)
        const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * sx)))
        const y0 = Math.floor(y * sy)
        const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * sy)))
        let sum = 0
        for (let yy = y0; yy < y1; yy++) {
          const row = yy * sw
          for (let xx = x0; xx < x1; xx++) sum += data[row + xx]
        }
        v = sum / ((x1 - x0) * (y1 - y0))
      } else {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5))
        const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5))
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const x1 = Math.min(sw - 1, x0 + 1)
        const y1 = Math.min(sh - 1, y0 + 1)
        const ax = fx - x0
        const ay = fy - y0
        const top = data[y0 * sw + x0] * (1 - ax) + data[y0 * sw + x1] * ax
        const bot = data[y1 * sw + x0] * (1 - ax) + data[y1 * sw + x1] * ax
        v = top * (1 - ay) + bot * ay
      }
      out[y * dw + x] = v
    }
  }
  return out
}

/** 灰度图 → MFR 输入张量 [1, 3, 384, 384]，值域 [-1, 1] */
export function toPixelValues(img: GrayImage, size = MFR_INPUT_SIZE): Float32Array {
  const resized = resizeGray(img, size, size)
  const plane = size * size
  const out = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    const v = (resized[i] / 255 - 0.5) / 0.5
    out[i] = v
    out[plane + i] = v
    out[plane * 2 + i] = v
  }
  return out
}
