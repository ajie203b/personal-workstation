/**
 * alpha 后处理（v3.3）：羽化、背景色估计、发丝边缘去溢出、letterbox 缩放、人像轻度提亮。
 * 全部纯函数（TypedArray），不碰 DOM，可直接单测。
 *
 * - featherAlpha：只对过渡带（0.04 < α < 0.96，及二值分割的硬跳变边）做盒式平滑，
 *   保留实心主体内部锐利边缘与干净背景，避免肩部/领口晕开产生白边。
 * - estimateLocalBackground / removeColorSpill：分块采样周边背景色并扩散插值，
 *   对半透明发丝/边缘做局部去溢出（深色西装肩部与亮背景不再受全局均值拖累）。
 * - letterboxToSquareRgba / unletterboxAlpha：保持人像宽高比进出 512×512 MODNet。
 */

/** 盒式羽化：radius 为模糊半径（像素），0/负数原样复制。只平滑过渡带，边缘按 clamp 取样 */
export function featherAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(alpha)
  const r = Math.round(radius)
  if (r <= 0 || width <= 0 || height <= 0) return out

  // 水平一趟
  const tmp = new Float32Array(out.length)
  const win = r * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let i = -r; i <= r; i++) sum += alpha[row + clampIdx(i, width)]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / win
      sum -= alpha[row + clampIdx(x - r, width)]
      sum += alpha[row + clampIdx(x + r + 1, width)]
    }
  }
  // 垂直一趟 → 写进 blurred，再按过渡带回填
  const blurred = new Float32Array(out.length)
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += tmp[clampIdx(i, height) * width + x]
    for (let y = 0; y < height; y++) {
      blurred[y * width + x] = sum / win
      sum -= tmp[clampIdx(y - r, height) * width + x]
      sum += tmp[clampIdx(y + r + 1, height) * width + x]
    }
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      const a = alpha[i]
      if (a > 0.04 && a < 0.96) {
        out[i] = blurred[i]
        continue
      }
      // 降级二值分割（0/1 硬跳变）缺少中间过渡像素，需把相邻 1px 跳变边也纳入羽化
      const isSolid = a >= 0.96
      const hasOpp =
        (x > 0 && (isSolid ? alpha[i - 1] <= 0.04 : alpha[i - 1] >= 0.96)) ||
        (x + 1 < width && (isSolid ? alpha[i + 1] <= 0.04 : alpha[i + 1] >= 0.96)) ||
        (y > 0 && (isSolid ? alpha[i - width] <= 0.04 : alpha[i - width] >= 0.96)) ||
        (y + 1 < height && (isSolid ? alpha[i + width] <= 0.04 : alpha[i + width] >= 0.96))
      if (hasOpp) out[i] = blurred[i]
    }
  }
  return out
}

function clampIdx(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i
}

/** 三元颜色 */
export type Rgb = [number, number, number]

/** 局部背景色网格（用于按过渡区周边背景去溢出） */
export interface LocalBgMap {
  gw: number
  gh: number
  cell: number
  /** gw*gh*3，每格估计出的局部背景 RGB */
  grid: Float32Array
}

/**
 * 估计全局背景色：取 alpha < 0.1 的像素 RGB 均值（这些像素认为只含背景）。
 * 一个都没有（整图都是人）就退回白色——换底场景里无所谓，反正是透明区。
 */
export function estimateBackground(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
): Rgb {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const total = width * height
  for (let i = 0; i < total && i < alpha.length; i++) {
    if (alpha[i] >= 0.1) continue
    const p = i * 4
    r += rgba[p]
    g += rgba[p + 1]
    b += rgba[p + 2]
    n++
  }
  if (!n) return [255, 255, 255]
  return [r / n, g / n, b / n]
}

/**
 * 估计局部背景色网格：在粗网格内统计 alpha < 0.08 的干净背景像素，
 * 对纯主体覆盖的空网格向邻格扩散补全，避免亮发区/暗西装肩部互相拉偏。
 */
export function estimateLocalBackground(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
): LocalBgMap {
  const cell = Math.max(4, Math.min(48, Math.round(Math.max(width, height) / 24)))
  const gw = Math.max(1, Math.ceil(width / cell))
  const gh = Math.max(1, Math.ceil(height / cell))
  const count = gw * gh
  const sumR = new Float32Array(count)
  const sumG = new Float32Array(count)
  const sumB = new Float32Array(count)
  const hits = new Uint32Array(count)

  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / cell))
    const row = y * width
    for (let x = 0; x < width; x++) {
      const idx = row + x
      if (idx >= alpha.length || alpha[idx] >= 0.08) continue
      const gIdx = gy * gw + Math.min(gw - 1, Math.floor(x / cell))
      const p = idx * 4
      sumR[gIdx] += rgba[p]
      sumG[gIdx] += rgba[p + 1]
      sumB[gIdx] += rgba[p + 2]
      hits[gIdx]++
    }
  }

  let grid = new Float32Array(count * 3)
  const valid = new Uint8Array(count)
  let anyValid = false
  for (let i = 0; i < count; i++) {
    if (hits[i] > 0) {
      grid[i * 3] = sumR[i] / hits[i]
      grid[i * 3 + 1] = sumG[i] / hits[i]
      grid[i * 3 + 2] = sumB[i] / hits[i]
      valid[i] = 1
      anyValid = true
    }
  }

  if (!anyValid) {
    const fallback = estimateBackground(rgba, alpha, width, height)
    for (let i = 0; i < count; i++) {
      grid[i * 3] = fallback[0]
      grid[i * 3 + 1] = fallback[1]
      grid[i * 3 + 2] = fallback[2]
    }
    return { gw, gh, cell, grid }
  }

  // 多轮 4/8 邻域扩散把背景色填进主体内部空白格
  const maxSteps = gw + gh
  for (let step = 0; step < maxSteps; step++) {
    let missing = false
    const nextGrid = new Float32Array(grid)
    const nextValid = new Uint8Array(valid)
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const gi = gy * gw + gx
        if (valid[gi]) continue
        let sr = 0
        let sg = 0
        let sb = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = gx + dx
            const ny = gy + dy
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
            const ni = ny * gw + nx
            if (!valid[ni]) continue
            sr += grid[ni * 3]
            sg += grid[ni * 3 + 1]
            sb += grid[ni * 3 + 2]
            n++
          }
        }
        if (n > 0) {
          nextGrid[gi * 3] = sr / n
          nextGrid[gi * 3 + 1] = sg / n
          nextGrid[gi * 3 + 2] = sb / n
          nextValid[gi] = 1
        } else {
          missing = true
        }
      }
    }
    grid = nextGrid
    valid.set(nextValid)
    if (!missing) break
  }

  return { gw, gh, cell, grid }
}

function sampleLocalBg(map: LocalBgMap, x: number, y: number, out: [number, number, number]): void {
  const gx = Math.min(map.gw - 1, Math.max(0, (x + 0.5) / map.cell - 0.5))
  const gy = Math.min(map.gh - 1, Math.max(0, (y + 0.5) / map.cell - 0.5))
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(map.gw - 1, x0 + 1)
  const y1 = Math.min(map.gh - 1, y0 + 1)
  const fx = gx - x0
  const fy = gy - y0
  const i00 = (y0 * map.gw + x0) * 3
  const i01 = (y0 * map.gw + x1) * 3
  const i10 = (y1 * map.gw + x0) * 3
  const i11 = (y1 * map.gw + x1) * 3
  for (let c = 0; c < 3; c++) {
    const top = map.grid[i00 + c] * (1 - fx) + map.grid[i01 + c] * fx
    const bot = map.grid[i10 + c] * (1 - fx) + map.grid[i11 + c] * fx
    out[c] = top * (1 - fy) + bot * fy
  }
}

function isLocalBgMap(bg: Rgb | LocalBgMap): bg is LocalBgMap {
  return !Array.isArray(bg)
}

/**
 * 去溢出（去白边）：只处理半透明过渡带（0.04 < a < 0.96），
 * 按 c = a·f + (1-a)·bg 反解 f = (c - (1-a)·bg) / a，clamp 到 0~255。
 * 传 LocalBgMap 时按像素位置双线性取局部背景色，传 Rgb 时用单一背景色。
 */
export function removeColorSpill(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  bg: Rgb | LocalBgMap,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  const total = Math.min(width * height, alpha.length)
  const local = isLocalBgMap(bg) ? bg : null
  const pixelBg: [number, number, number] = isLocalBgMap(bg) ? [0, 0, 0] : [bg[0], bg[1], bg[2]]

  for (let i = 0; i < total; i++) {
    const a = alpha[i]
    if (a <= 0.04 || a >= 0.96) continue
    if (local) {
      const y = (i / width) | 0
      const x = i - y * width
      sampleLocalBg(local, x, y, pixelBg)
    }
    const p = i * 4
    for (let c = 0; c < 3; c++) {
      const mixed = out[p + c]
      const fg = (mixed - (1 - a) * pixelBg[c]) / a
      out[p + c] = fg < 0 ? 0 : fg > 255 ? 255 : fg
    }
  }
  return out
}

export interface LetterboxInfo {
  size: number
  scaledW: number
  scaledH: number
  padX: number
  padY: number
}

/** 计算将 srcW×srcH 等比放进 size×size 正方形的缩放与对称留边参数 */
export function computeLetterbox(srcW: number, srcH: number, targetSize: number): LetterboxInfo {
  const size = Math.max(1, Math.round(targetSize))
  const w = Math.max(1, srcW)
  const h = Math.max(1, srcH)
  const scale = size / Math.max(w, h)
  const scaledW = Math.max(1, Math.min(size, Math.round(w * scale)))
  const scaledH = Math.max(1, Math.min(size, Math.round(h * scale)))
  const padX = Math.floor((size - scaledW) / 2)
  const padY = Math.floor((size - scaledH) / 2)
  return { size, scaledW, scaledH, padX, padY }
}

/**
 * 等比缩放到 targetSize×targetSize（边缘像素外延填充留白区，避免人工黑边干扰边缘推理），
 * 防止竖图/横图被拉伸变形。
 */
export function letterboxToSquareRgba(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  targetSize: number,
): { data: Uint8ClampedArray; info: LetterboxInfo } {
  const info = computeLetterbox(srcW, srcH, targetSize)
  const { size, scaledW, scaledH, padX, padY } = info
  const scaled = resizeRgba(rgba, srcW, srcH, scaledW, scaledH)
  if (scaledW === size && scaledH === size && padX === 0 && padY === 0) {
    return { data: scaled, info }
  }
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    const sy = Math.min(scaledH - 1, Math.max(0, y - padY))
    for (let x = 0; x < size; x++) {
      const sx = Math.min(scaledW - 1, Math.max(0, x - padX))
      const src = (sy * scaledW + sx) * 4
      const dst = (y * size + x) * 4
      data[dst] = scaled[src]
      data[dst + 1] = scaled[src + 1]
      data[dst + 2] = scaled[src + 2]
      data[dst + 3] = scaled[src + 3]
    }
  }
  return { data, info }
}

/** 从 letterbox 输出的 targetSize×targetSize alpha 中裁回原图比例区并上采样到 dstW×dstH */
export function unletterboxAlpha(
  squareAlpha: Float32Array,
  targetSize: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const { size, scaledW, scaledH, padX, padY } = computeLetterbox(dstW, dstH, targetSize)
  if (scaledW === size && scaledH === size && padX === 0 && padY === 0) {
    return resizeAlpha(squareAlpha, size, size, dstW, dstH)
  }
  const cropped = new Float32Array(scaledW * scaledH)
  for (let y = 0; y < scaledH; y++) {
    const srcOff = (y + padY) * size + padX
    cropped.set(squareAlpha.subarray(srcOff, srcOff + scaledW), y * scaledW)
  }
  return resizeAlpha(cropped, scaledW, scaledH, dstW, dstH)
}

const BRIGHTEN_LUT = (() => {
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    // 温和伽马提亮（0.90）+ 微幅中调提纯，保留高光不过曝、黑发不变灰
    const t = i / 255
    const lifted = Math.pow(t, 0.9)
    const sCurve = lifted + 0.03 * Math.sin(Math.PI * lifted) * (1 - t)
    lut[i] = Math.min(255, Math.max(0, Math.round(sCurve * 255)))
  }
  return lut
})()

/**
 * 轻度人像提亮：只提亮前景主体（alpha > 0.04 按 alpha 权重混合），不碰背景。
 */
export function applyPortraitBrighten(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  const total = Math.min(width * height, alpha.length)
  for (let i = 0; i < total; i++) {
    const a = alpha[i]
    if (a <= 0.04) continue
    const w = a >= 0.96 ? 1 : a
    const p = i * 4
    for (let c = 0; c < 3; c++) {
      const v = out[p + c]
      out[p + c] = Math.round(v + (BRIGHTEN_LUT[v] - v) * w)
    }
  }
  return out
}

/** 双线性缩放单通道 alpha（0~1）；推理输出 512×512 上采样回原尺寸用 */
export function resizeAlpha(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh)
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yr - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xr - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const v00 = src[y0 * sw + x0]
      const v01 = src[y0 * sw + x1]
      const v10 = src[y1 * sw + x0]
      const v11 = src[y1 * sw + x1]
      out[y * dw + x] =
        v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy
    }
  }
  return out
}

/** 双线性缩放 RGBA 像素（抠图推理前把工作图缩到 512） */
export function resizeRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yr - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xr - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const p00 = (y0 * sw + x0) * 4
      const p01 = (y0 * sw + x1) * 4
      const p10 = (y1 * sw + x0) * 4
      const p11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        out[o + c] =
          src[p00 + c] * (1 - fx) * (1 - fy) +
          src[p01 + c] * fx * (1 - fy) +
          src[p10 + c] * (1 - fx) * fy +
          src[p11 + c] * fx * fy
      }
    }
  }
  return out
}
