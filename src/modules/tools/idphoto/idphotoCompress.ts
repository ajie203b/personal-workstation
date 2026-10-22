/**
 * 体积压缩与 JPEG 头（v3.3）：压到指定 KB、写 JFIF APP0 的 DPI 字段。纯函数/可注入编码器，
 * 二分逻辑可单测（mock toBlob）。
 *
 * - compressJpegToKb：quality 0.4~0.95 二分（质量越高文件越大，单调）；
 *   质量压到下限仍超 maxKb → 缩尺寸重来；低于 minKb → 提质量（已到 0.95 顶就认了）。
 * - canvas.toBlob('image/jpeg') 产出的是无 EXIF 的新 JPEG（自然去掉了方向/相机信息），
 *   但 DPI 会被写成 72，所以再用 setJpegDpi 改写 APP0 的 X/Y density（units=1 即 dpi）。
 */

export interface CompressTarget {
  /** 体积下限（KB） */
  minKb: number
  /** 体积上限（KB） */
  maxKb: number
  /** 起始像素宽高 */
  width: number
  height: number
}

export interface CompressResult {
  blob: Blob
  quality: number
  width: number
  height: number
  /** 实际体积（字节） */
  bytes: number
  /** 尺寸被缩过几轮（0 = 原尺寸） */
  shrinks: number
}

/** 编码器：给定质量与尺寸产出 JPEG blob（页面里包 canvas.toBlob，测试里 mock） */
export type JpegEncoder = (quality: number, width: number, height: number) => Promise<Blob>

/** 二分的精度：质量步进小于 0.01 就停 */
const QUALITY_MIN = 0.4
const QUALITY_MAX = 0.95
const QUALITY_STEP = 0.01
/** 超大时每次缩到 0.85，最多缩 6 轮（约 0.38 倍边长） */
const SHRINK_FACTOR = 0.85
const MAX_SHRINKS = 6

const kb = (bytes: number) => bytes / 1024

/**
 * 二分压到 [minKb, maxKb]。
 *
 * 1. q=0.4 就超 maxKb → 缩尺寸再试（"到下限仍超大再缩尺寸"）；
 * 2. 否则二分出不超过 maxKb 的最大质量；结果低于 minKb 说明 0.95 也不够大，
 *    质量已到顶，直接返回（"低于下限提高质量"，能提的都提了）。
 */
export async function compressJpegToKb(
  encode: JpegEncoder,
  target: CompressTarget,
): Promise<CompressResult> {
  const maxBytes = Math.max(1024, target.maxKb * 1024)
  const minBytes = Math.max(0, target.minKb * 1024)

  let width = Math.max(1, Math.round(target.width))
  let height = Math.max(1, Math.round(target.height))
  let shrinks = 0

  for (;;) {
    // 质量下限时仍超上限 → 缩尺寸
    const floor = await encode(QUALITY_MIN, width, height)
    if (floor.size > maxBytes && shrinks < MAX_SHRINKS && width > 64 && height > 64) {
      width = Math.max(64, Math.round(width * SHRINK_FACTOR))
      height = Math.max(64, Math.round(height * SHRINK_FACTOR))
      shrinks++
      continue
    }

    // 二分：找不超过 maxBytes 的最大质量
    let lo = QUALITY_MIN
    let hi = QUALITY_MAX
    let best = floor
    let bestQ = QUALITY_MIN
    while (hi - lo >= QUALITY_STEP) {
      const mid = Math.round(((lo + hi) / 2) * 100) / 100
      const blob = await encode(mid, width, height)
      if (blob.size > maxBytes) {
        hi = mid
      } else {
        lo = mid
        best = blob
        bestQ = mid
      }
    }

    // 低于下限 → 提质量；二分终点就是不超过上限的最大质量，到 0.95 仍小则认了
    if (kb(best.size) < kb(minBytes) && bestQ < QUALITY_MAX) {
      const top = await encode(QUALITY_MAX, width, height)
      if (top.size <= maxBytes) {
        best = top
        bestQ = QUALITY_MAX
      }
    }

    return { blob: best, quality: bestQ, width, height, bytes: best.size, shrinks }
  }
}

// ---------- JFIF APP0 的 DPI ----------

const SOI = 0xffd8

/** 构造标准 JFIF APP0 段（16 字节，含长度字段）：units=1 表示 dpi */
function buildApp0(dpiX: number, dpiY: number): Uint8Array {
  const seg = new Uint8Array(18)
  seg[0] = 0xff
  seg[1] = 0xe0
  seg[2] = 0x00
  seg[3] = 0x10 // 段长 16
  // "JFIF\0"
  seg[4] = 0x4a
  seg[5] = 0x46
  seg[6] = 0x49
  seg[7] = 0x46
  seg[8] = 0x00
  seg[9] = 0x01 // version 1.1
  seg[10] = 0x01
  seg[11] = 0x01 // units = 1（dots per inch）
  seg[12] = (dpiX >> 8) & 0xff
  seg[13] = dpiX & 0xff
  seg[14] = (dpiY >> 8) & 0xff
  seg[15] = dpiY & 0xff
  seg[16] = 0x00 // Xthumbnail
  seg[17] = 0x00 // Ythumbnail
  return seg
}

function clampDpi(v: number): number {
  if (!Number.isFinite(v)) return 300
  return Math.min(65535, Math.max(1, Math.round(v)))
}

/** 在 JPEG 字节流里定位 JFIF APP0 段，返回段起点（FF E0 处）；找不到 -1 */
function findJfifApp0(bytes: Uint8Array): number {
  if (bytes.length < 4 || (bytes[0] << 8 | bytes[1]) !== SOI) return -1
  let off = 2
  while (off + 3 < bytes.length) {
    if (bytes[off] !== 0xff) return -1
    const marker = bytes[off + 1]
    // 无长度的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2
      continue
    }
    // SOS / EOI 之后不再有元数据段
    if (marker === 0xda || marker === 0xd9) return -1
    const segLen = (bytes[off + 2] << 8) | bytes[off + 3]
    if (segLen < 2) return -1
    if (
      marker === 0xe0 &&
      segLen >= 16 &&
      bytes[off + 4] === 0x4a &&
      bytes[off + 5] === 0x46 &&
      bytes[off + 6] === 0x49 &&
      bytes[off + 7] === 0x46 &&
      bytes[off + 8] === 0x00
    ) {
      return off
    }
    off += 2 + segLen
  }
  return -1
}

/**
 * 改写 JFIF APP0 的 DPI（X/Y density，units=1）。已有 JFIF 段就地更新；
 * 没有就在 SOI 后插入一段；不是 JPEG 原样返回。不改输入，返回新字节数组。
 */
export function setJpegDpi(bytes: Uint8Array, dpiX: number, dpiY = dpiX): Uint8Array {
  const dx = clampDpi(dpiX)
  const dy = clampDpi(dpiY)
  if (bytes.length < 2 || (bytes[0] << 8 | bytes[1]) !== SOI) return new Uint8Array(bytes)
  const at = findJfifApp0(bytes)
  if (at < 0) {
    // 没有 JFIF 段：SOI 后插入
    const seg = buildApp0(dx, dy)
    const out = new Uint8Array(bytes.length + seg.length)
    out.set(bytes.subarray(0, 2), 0)
    out.set(seg, 2)
    out.set(bytes.subarray(2), 2 + seg.length)
    return out
  }
  const out = new Uint8Array(bytes)
  out[at + 11] = 0x01 // units = dpi
  out[at + 12] = (dx >> 8) & 0xff
  out[at + 13] = dx & 0xff
  out[at + 14] = (dy >> 8) & 0xff
  out[at + 15] = dy & 0xff
  return out
}

export interface JpegDpi {
  dpiX: number
  dpiY: number
  /** JFIF units：0 无单位 / 1 dpi / 2 点每厘米 */
  units: number
}

/** 读回 DPI（校验用）：没有 JFIF APP0 返回 null */
export function readJpegDpi(bytes: Uint8Array): JpegDpi | null {
  const at = findJfifApp0(bytes)
  if (at < 0) return null
  return {
    units: bytes[at + 11],
    dpiX: (bytes[at + 12] << 8) | bytes[at + 13],
    dpiY: (bytes[at + 14] << 8) | bytes[at + 15],
  }
}

/** 便捷：blob → 改 DPI → 新 blob（页面导出前用） */
export async function applyJpegDpi(blob: Blob, dpiX: number, dpiY = dpiX): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const patched = setJpegDpi(bytes, dpiX, dpiY)
  return new Blob([patched], { type: 'image/jpeg' })
}

/** canvas.toBlob 包装成 Promise（页面里的默认编码器） */
export function canvasJpegEncoder(canvas: HTMLCanvasElement): JpegEncoder {
  return (quality, width, height) =>
    new Promise<Blob>((resolve, reject) => {
      const tmp = document.createElement('canvas')
      tmp.width = width
      tmp.height = height
      const ctx = tmp.getContext('2d')
      if (!ctx) {
        reject(new Error('画布创建失败'))
        return
      }
      ctx.drawImage(canvas, 0, 0, width, height)
      tmp.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('JPEG 编码失败'))),
        'image/jpeg',
        quality,
      )
    })
}
