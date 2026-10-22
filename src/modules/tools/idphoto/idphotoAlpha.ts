/**
 * alpha 后处理（v3.3）：羽化、背景色估计、发丝边缘去溢出。全部纯函数（TypedArray），
 * 不碰 DOM，可直接单测。
 *
 * - featherAlpha：可分离盒式模糊，1~2px 就够把 512 推理上采样后的锯齿边抹圆。
 * - estimateBackground：从 alpha≈0 的像素估背景色（换底后要重新估，否则会把新底色
 *   当原背景做去溢出）。
 * - removeColorSpill：半透明边缘按 c = a·f + (1-a)·bg 反解前景 f，剔除发丝里
 *   混进来的背景色（去白边/彩边）。
 */

/** 盒式羽化：radius 为模糊半径（像素），0/负数原样复制。边缘像素按 clamp 取样 */
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
    // 初始窗口 [-r, r]
    for (let i = -r; i <= r; i++) sum += out[row + clampIdx(i, width)]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / win
      sum -= out[row + clampIdx(x - r, width)]
      sum += out[row + clampIdx(x + r + 1, width)]
    }
  }
  // 垂直一趟
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += tmp[clampIdx(i, height) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / win
      sum -= tmp[clampIdx(y - r, height) * width + x]
      sum += tmp[clampIdx(y + r + 1, height) * width + x]
    }
  }
  return out
}

function clampIdx(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i
}

/** 三元颜色 */
export type Rgb = [number, number, number]

/**
 * 估计背景色：取 alpha < 0.1 的像素 RGB 均值（这些像素认为只含背景）。
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
 * 去溢出（去白边）：只处理半透明边缘像素（0 < a < 0.98），
 * 按 c = a·f + (1-a)·bg 反解 f = (c - (1-a)·bg) / a，clamp 到 0~255。
 * 全透明/实心像素原样保留，避免动到主体内部颜色。
 */
export function removeColorSpill(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  bg: Rgb,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  const total = Math.min(width * height, alpha.length)
  for (let i = 0; i < total; i++) {
    const a = alpha[i]
    if (a <= 0 || a >= 0.98) continue
    const p = i * 4
    for (let c = 0; c < 3; c++) {
      const mixed = out[p + c]
      const fg = (mixed - (1 - a) * bg[c]) / a
      out[p + c] = fg < 0 ? 0 : fg > 255 ? 255 : fg
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
