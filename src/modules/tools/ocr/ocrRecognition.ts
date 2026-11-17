import type { Point, Quad } from './ocrDetection'

/** 识别输入高度（PP-OCR rec 固定 48） */
export const REC_IMG_HEIGHT = 48
/**
 * 识别输入宽度上限。PP-OCRv4 rec 是动态宽度（官方推理按 max_wh_ratio 放宽，
 * 不硬卡 320）；卡 320 会把一整行长文字压扁到字符挤成一团。
 * 取 48×40=1920：手机截图一整行中文（宽高比 ~25）也不会被压缩。
 */
export const REC_IMG_MAX_WIDTH = 1920
/** 低于此置信度在界面上标黄 */
export const LOW_CONFIDENCE = 0.75

/** 求 3x3 单应矩阵（把目标矩形四角映射到源四边形），返回 8 个自由参数 */
function solveHomography(dst: Point[], src: Point[]): number[] | null {
  // 8x9 增广矩阵，未知数 [h0..h7]（h8 = 1）
  const m: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]
    const { x, y } = src[i]
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    if (Math.abs(m[pivot][col]) < 1e-9) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const d = m[col][col]
    for (let k = col; k < 9; k++) m[col][k] /= d
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (f === 0) continue
      for (let k = col; k < 9; k++) m[r][k] -= f * m[col][k]
    }
  }
  return m.map((row) => row[8])
}

/**
 * 透视（单应）裁剪：把四边形区域拉正成 dw×dh 的 RGBA 图。
 * 目标矩形四角对应 quad 的 左上/右上/右下/左下，双线性采样。
 */
export function warpQuadRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  quad: Quad,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  // 注意方向：solveHomography(dst, src) 求的是「目标坐标 → 源坐标」的映射，
  // 这里要的是「输出条带像素 (u,v) → 源图像素」，所以 dst 是输出矩形、src 是检测框。
  // v3.3.0~3.3.2 把两者传反了：采样点全落在图外，条带整片 128 灰，识别永远是空串
  // →「没有识别到文字」。
  const h = solveHomography(
    [
      { x: 0, y: 0 },
      { x: dw, y: 0 },
      { x: dw, y: dh },
      { x: 0, y: dh },
    ],
    [quad[0], quad[1], quad[2], quad[3]],
  )
  if (!h) {
    // 退化四边形（四点共线等）：直接返回中性灰，避免整条管线失败
    out.fill(128)
    return out
  }
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const u = x + 0.5
      const v = y + 0.5
      const denom = h[6] * u + h[7] * v + 1
      const sx = (h[0] * u + h[1] * v + h[2]) / denom - 0.5
      const sy = (h[3] * u + h[4] * v + h[5]) / denom - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        let acc = 0
        let wsum = 0
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const px = x0 + i
            const py = y0 + j
            if (px < 0 || py < 0 || px >= sw || py >= sh) continue
            const w = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fy : fy)
            acc += src[(py * sw + px) * 4 + c] * w
            wsum += w
          }
        }
        out[o + c] = wsum > 0 ? acc / wsum : 128
      }
    }
  }
  return out
}

function quadDimensions(quad: Quad): { w: number; h: number } {
  const [tl, tr, br, bl] = quad
  const w = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2
  const h = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2
  return { w, h }
}

/** 竖排文字框判定（高度 > 1.5 倍宽度时，PP-OCR 需逆时针旋转 90° 送入 rec） */
export function isVerticalQuad(quad: Quad): boolean {
  const { w, h } = quadDimensions(quad)
  return h > 1.5 * Math.max(1e-6, w)
}

/** 将 RGBA 像素缓冲区逆时针旋转 90°（对齐 np.rot90(img, k=1)） */
export function rotateRgba90Ccw(
  src: Uint8ClampedArray,
  width: number,
  height: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const outW = height
  const outH = width
  const data = new Uint8ClampedArray(outW * outH * 4)
  for (let dy = 0; dy < outH; dy++) {
    const sx = width - 1 - dy
    for (let dx = 0; dx < outW; dx++) {
      const sy = dx
      const sOff = (sy * width + sx) * 4
      const dOff = (dy * outW + dx) * 4
      data[dOff] = src[sOff]
      data[dOff + 1] = src[sOff + 1]
      data[dOff + 2] = src[sOff + 2]
      data[dOff + 3] = src[sOff + 3]
    }
  }
  return { data, width: outW, height: outH }
}

/** 识别输入尺寸：高度固定 48，宽度按长边/短边比例取整（竖排先转正再算），夹在 [16, REC_IMG_MAX_WIDTH] */
export function recStripSize(quad: Quad): { width: number; height: number } {
  const { w, h } = quadDimensions(quad)
  const ratio = h > 1.5 * Math.max(1e-6, w) ? h / Math.max(1, w) : w / Math.max(1, h)
  const width = Math.min(REC_IMG_MAX_WIDTH, Math.max(16, Math.round(REC_IMG_HEIGHT * ratio)))
  return { width, height: REC_IMG_HEIGHT }
}

/**
 * 裁剪并准备送入 rec 识别模型的横条像素：
 * 水平文本框直接透视拉正；竖排中文框（height > 1.5 * width）先拉正到竖条再逆时针旋转 90°。
 */
export function extractRecStrip(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  quad: Quad,
): { data: Uint8ClampedArray; width: number; height: number; rotated: boolean } {
  const size = recStripSize(quad)
  if (isVerticalQuad(quad)) {
    const warped = warpQuadRgba(src, sw, sh, quad, REC_IMG_HEIGHT, size.width)
    const rotated = rotateRgba90Ccw(warped, REC_IMG_HEIGHT, size.width)
    return { ...rotated, rotated: true }
  }
  const data = warpQuadRgba(src, sw, sh, quad, size.width, size.height)
  return { data, width: size.width, height: size.height, rotated: false }
}

/** 解析 ppocr 字典：每行一个字符，末尾补空格（use_space_char: true） */
export function parseCharset(dictText: string): string[] {
  const chars = dictText.split(/\r?\n/).filter((line) => line !== '')
  return [...chars, ' ']
}

export interface CtcResult {
  text: string
  confidence: number
}

/**
 * CTC 贪心解码：逐步取 argmax，去 blank（下标 0）并折叠连续重复，
 * 字符表 charset 对应下标 1..C-1（下标 0 是 blank，不在 charset 里）。
 * 置信度取贡献字符步的平均最大概率。
 */
export function ctcGreedyDecode(
  probs: ArrayLike<number>,
  timeSteps: number,
  classes: number,
  charset: string[],
): CtcResult {
  let text = ''
  let sum = 0
  let count = 0
  let prev = -1
  for (let t = 0; t < timeSteps; t++) {
    const base = t * classes
    let best = 0
    let bestP = -Infinity
    for (let c = 0; c < classes; c++) {
      const p = probs[base + c]
      if (p > bestP) {
        bestP = p
        best = c
      }
    }
    if (best === 0) {
      prev = -1
      continue
    }
    if (best === prev) continue
    prev = best
    const ch = charset[best - 1]
    if (ch === undefined) continue
    text += ch
    sum += bestP
    count++
  }
  return { text, confidence: count > 0 ? sum / count : 0 }
}
