/** 从 RGBA 里裁出一个矩形（整数坐标） */
export function cropRgba(
  src: Uint8ClampedArray,
  sw: number,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * sw + x) * 4
    out.set(src.subarray(s, s + w * 4), row * w * 4)
  }
  return out
}

/** 双线性缩放 RGBA 像素（纯 TypedArray 实现，Worker 里不需要 canvas） */
export function resizeRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
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
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        out[o + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}

/**
 * RGBA → CHW 归一化张量（BGR 通道序，即平面 0=B、1=G、2=R）。
 * det / rec 都吃 BGR，差别只在 mean/std。
 */
export function rgbaToChwTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mean: [number, number, number],
  std: [number, number, number],
): Float32Array {
  const plane = width * height
  const out = new Float32Array(3 * plane)
  const b = plane
  const g = plane * 2
  for (let i = 0; i < plane; i++) {
    const s = i * 4
    out[i] = (rgba[s + 2] / 255 - mean[0]) / std[0] // B
    out[b + i] = (rgba[s + 1] / 255 - mean[1]) / std[1] // G
    out[g + i] = (rgba[s] / 255 - mean[2]) / std[2] // R
  }
  return out
}

/** det 归一化：ImageNet 统计（PaddleOCR det 配置） */
export function toDetTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  return rgbaToChwTensor(rgba, width, height, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
}

/** rec 归一化：(x/255 - 0.5) / 0.5（PaddleOCR rec 配置） */
export function toRecTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  return rgbaToChwTensor(rgba, width, height, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
}
