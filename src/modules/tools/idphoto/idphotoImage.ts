/**
 * 证件照选图：解码 + EXIF 转正 + 缩到工作尺寸 + 按眼睛扶正（v3.3.3，依赖 DOM canvas）。
 */
import { orientationTransform, readJpegOrientation, resetJpegOrientation } from './idphotoExif'
import type { RgbaImage } from './idphotoEngine'

/** 解码成可绘制对象（ImageBitmap 优先，老 WebView 退回 <img>） */
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob)
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() }
    } catch {
      // 落到 <img>
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('这张图读不出来，换一张试试'))
      el.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/**
 * 读图并按 EXIF 方向真正转正，缩到最长边 maxEdge，返回 RGBA。
 *
 * JPEG：自己解析 Orientation → 副本里改成 1 → 按原始像素解码 → 用变换矩阵画正。
 * 这样不依赖浏览器对 imageOrientation / image-orientation 的实现（各版本 WebView 不一致）。
 * 其他格式（PNG / WebP 等）没有 EXIF 方向问题，直接解码。
 */
export async function loadOrientedImage(file: Blob, maxEdge: number): Promise<RgbaImage & { orientation: number }> {
  let blob: Blob = file
  let orientation = 1
  try {
    const head = new Uint8Array(await file.arrayBuffer())
    const info = readJpegOrientation(head)
    if (info && info.orientation !== 1) {
      orientation = info.orientation
      blob = new Blob([resetJpegOrientation(head, info) as BlobPart], { type: file.type || 'image/jpeg' })
    }
  } catch {
    // 读不到 EXIF 就按原样解码
  }
  const dec = await decode(blob)
  try {
    const t = orientationTransform(orientation, dec.width, dec.height)
    const scale = Math.min(1, maxEdge / Math.max(t.width, t.height))
    const w = Math.max(1, Math.round(t.width * scale))
    const h = Math.max(1, Math.round(t.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画布创建失败')
    ctx.imageSmoothingQuality = 'high'
    ctx.scale(scale, scale)
    ctx.transform(...t.matrix)
    ctx.drawImage(dec.source, 0, 0)
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, orientation }
  } finally {
    dec.close()
  }
}

/**
 * 绕 (cx, cy) 旋转整张图 angle 弧度（正值视觉上顺时针），尺寸不变。
 * 旋转后露出的角先铺一层原图（角落离人脸很远，比黑角好看），再画旋转后的图。
 */
export function rotateRgba(image: RgbaImage, angle: number, cx: number, cy: number): RgbaImage {
  const src = document.createElement('canvas')
  src.width = image.width
  src.height = image.height
  const sctx = src.getContext('2d')
  if (!sctx) throw new Error('画布创建失败')
  sctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  const out = document.createElement('canvas')
  out.width = image.width
  out.height = image.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('画布创建失败')
  ctx.drawImage(src, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.translate(-cx, -cy)
  ctx.drawImage(src, 0, 0)
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height }
}
