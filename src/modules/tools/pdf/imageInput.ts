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

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

/** 优先读 file.type，为空时按文件扩展名回退推断 MIME 类型。 */
export function inferImageMime(file: Pick<File, 'type' | 'name'>): string {
  const mime = file.type.trim().toLowerCase()
  if (mime) return mime
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  return ext ? EXT_MIME[ext] ?? '' : ''
}

/** 将位图按指定 90° 倍数顺时针旋转后绘制到 canvas 并导出为 PNG 或白底 JPEG。 */
export async function renderBitmapToBytes(
  bitmap: ImageBitmap,
  opts: { kind: 'jpeg' | 'png'; rotation?: number; quality?: number },
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const rot = (((opts.rotation ?? 0) % 360) + 360) % 360
  const swapped = rot === 90 || rot === 270
  const width = swapped ? bitmap.height : bitmap.width
  const height = swapped ? bitmap.width : bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 canvas，无法转换图片')
  if (opts.kind === 'jpeg') {
    // 非 PNG 透明图（WebP/GIF/SVG）转 JPEG 时先铺白底，防止透明区域变黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.translate(width / 2, height / 2)
  if (rot) ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  const mime = opts.kind === 'png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, opts.quality ?? 0.92))
  if (!blob) throw new Error(`图片转 ${opts.kind.toUpperCase()} 失败`)
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

async function decode(file: File, imageOrientation: 'from-image' | 'none'): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation })
  } catch {
    // 老 WebView 不认 imageOrientation 参数时退回默认解码
    return createImageBitmap(file)
  }
}

/** 单张图片 → 嵌入素材（转正 + 按需旋转 + 必要时白底重编码） */
export async function fileToEmbeddedImage(file: File, rotation = 0): Promise<EmbeddedImage> {
  const raw = new Uint8Array(await file.arrayBuffer())
  const type = inferImageMime(file)
  const rot = (((rotation % 360) + 360) % 360)

  if (type === 'image/png') {
    const bmp = await decode(file, 'from-image')
    try {
      if (rot === 0) return { bytes: raw, kind: 'png', width: bmp.width, height: bmp.height }
      const rendered = await renderBitmapToBytes(bmp, { kind: 'png', rotation: rot })
      return { ...rendered, kind: 'png' }
    } finally {
      bmp.close?.()
    }
  }

  const oriented = await decode(file, 'from-image')
  try {
    const width = oriented.width
    const height = oriented.height

    if (type === 'image/jpeg' && rot === 0 && readJpegOrientation(raw) <= 1) {
      // 没有方向信息且未手动旋转：原图直贴保画质
      return { bytes: raw, kind: 'jpeg', width, height }
    }

    const rendered = await renderBitmapToBytes(oriented, { kind: 'jpeg', rotation: rot })
    return { ...rendered, kind: 'jpeg' }
  } finally {
    oriented.close?.()
  }
}
