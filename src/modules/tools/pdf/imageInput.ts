/**
 * 图片文件 → 可嵌 PDF 的字节（PNG 原样 / JPEG 原样或重编码）。
 *
 * EXIF 方向：先读 JPEG 的 APP1 里 Orientation 标签（1 以外都要转正），
 * 转正统一交给 createImageBitmap(file, { imageOrientation: 'from-image' })；
 * - JPEG：无方向信息 → 原字节 embedJpg（保画质）；有 → 转正后重编码；
 * - PNG：基本没有 EXIF 方向，原字节直接 embedPng（保透明通道）；
 * - 其他（webp/gif/bmp…）：一律转正后画进 canvas 再出 JPEG。
 *
 * 为什么不靠「两次解码比宽高」：orientation 2/3/4（镜像 / 180°）不换宽高，
 * 会被漏掉，贴进 PDF 的照片就是歪的/反的。
 */

export interface EmbeddedImage {
  bytes: Uint8Array
  kind: 'jpeg' | 'png'
  /** 转正后的像素尺寸（版式计算用） */
  width: number
  height: number
}

/**
 * 读 JPEG 的 EXIF Orientation（1~8）；没有 EXIF 或不认识返回 0。
 * 只扫段结构不碰压缩数据，几 KB 的图也是微秒级。
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  // SOI
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 0
  let off = 2
  while (off + 3 < bytes.length) {
    if (bytes[off] !== 0xff) return 0
    const marker = bytes[off + 1]
    // 无长度的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2
      continue
    }
    // SOS 之后就是压缩数据，不再有元数据段
    if (marker === 0xda || marker === 0xd9) return 0
    const segLen = (bytes[off + 2] << 8) | bytes[off + 3]
    if (marker === 0xe1 && segLen >= 16) {
      const start = off + 4
      // Exif\0\0
      if (
        bytes[start] === 0x45 &&
        bytes[start + 1] === 0x78 &&
        bytes[start + 2] === 0x69 &&
        bytes[start + 3] === 0x66
      ) {
        return tiffOrientation(bytes, start + 6)
      }
    }
    off += 2 + segLen
  }
  return 0
}

/** TIFF 头（APP1 里 Exif\0\0 之后）：读 IFD0 的 Orientation 标签 */
function tiffOrientation(t: Uint8Array, base: number): number {
  const le = t[base] === 0x49 // 'II' 小端，'MM' 大端
  const u16 = (p: number) => (le ? t[p] | (t[p + 1] << 8) : (t[p] << 8) | t[p + 1])
  const u32 = (p: number) =>
    le ? (t[p] | (t[p + 1] << 8) | (t[p + 2] << 16) | (t[p + 3] << 24)) >>> 0 : ((t[p] << 24) | (t[p + 1] << 16) | (t[p + 2] << 8) | t[p + 3]) >>> 0
  if (base + 8 > t.length) return 0
  if (u16(base + 2) !== 42) return 0
  const ifd = base + u32(base + 4)
  if (ifd + 2 > t.length) return 0
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > t.length) return 0
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8)
      return v >= 1 && v <= 8 ? v : 0
    }
  }
  return 0
}

async function bitmapToJpeg(bitmap: ImageBitmap, quality = 0.92): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 canvas，无法转换图片')
  ctx.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('图片转 JPEG 失败')
  return new Uint8Array(await blob.arrayBuffer())
}

async function decode(file: File, imageOrientation: 'from-image' | 'none'): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation })
  } catch {
    // 老 WebView 不认 imageOrientation 参数时退回默认解码
    return createImageBitmap(file)
  }
}

/** 单张图片 → 嵌入素材（转正 + 必要时重编码） */
export async function fileToEmbeddedImage(file: File): Promise<EmbeddedImage> {
  const raw = new Uint8Array(await file.arrayBuffer())
  const type = file.type.toLowerCase()

  if (type === 'image/png') {
    const bmp = await decode(file, 'from-image')
    const size = { width: bmp.width, height: bmp.height }
    bmp.close?.()
    return { bytes: raw, kind: 'png', ...size }
  }

  const oriented = await decode(file, 'from-image')
  const width = oriented.width
  const height = oriented.height

  if (type === 'image/jpeg' && readJpegOrientation(raw) <= 1) {
    // 没有方向信息：原图直贴保画质
    oriented.close?.()
    return { bytes: raw, kind: 'jpeg', width, height }
  }

  const bytes = await bitmapToJpeg(oriented)
  oriented.close?.()
  return { bytes, kind: 'jpeg', width, height }
}
