import jsQR from 'jsqr'

/**
 * 二维码识别侧：各种图片来源（相册/拍照/粘贴/摄像头帧）统一成 ImageData，
 * 解码优先走系统 BarcodeDetector（有硬件加速），没有再退回 jsQR（纯 JS）。
 * 全程本地计算，不联网。
 */

/** 转出的像素结构（jsQR 只要 data/width/height 三个字段） */
export interface PixelSource {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Blob（图片文件）→ ImageData。用 <img> + canvas，兼容性比 createImageBitmap 好 */
export async function blobToImageData(blob: Blob): Promise<PixelSource> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片加载失败'))
      el.src = url
    })
    return imageToImageData(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** HTMLImageElement → ImageData（长边压到 1600px 以内，超大截图也扫得动、又不吃内存） */
export function imageToImageData(img: HTMLImageElement): PixelSource {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) throw new Error('图片尺寸为空')
  const maxSide = 1600
  const ratio = Math.min(1, maxSide / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * ratio)
  canvas.height = Math.round(h * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** 粘贴 / 文件选择拿到的 File → ImageData */
export async function fileToImageData(file: Blob): Promise<PixelSource> {
  return blobToImageData(file)
}

/** 纯 jsQR 解码（自检也走这里，保证口径一致） */
export async function decodeWithJsQr(source: PixelSource): Promise<string | null> {
  const res = jsQR(source.data, source.width, source.height)
  return res?.data ?? null
}

/* ---------------- BarcodeDetector（浏览器原生，可能不存在） ---------------- */

interface DetectedBarcodeLike {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: PixelSource | Blob | HTMLCanvasElement): Promise<DetectedBarcodeLike[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

/**
 * 解码入口：优先 BarcodeDetector（Chrome/安卓 WebView 有硬件加速），
 * 不支持或出错时退回 jsQR，两条路都试不出才算没扫到。
 */
export async function decodeImageData(source: PixelSource): Promise<string | null> {
  const Ctor = getBarcodeDetector()
  if (Ctor) {
    try {
      const detector = new Ctor({ formats: ['qr_code'] })
      const codes = await detector.detect(source)
      const hit = codes.find((c) => c.rawValue)
      if (hit) return hit.rawValue
    } catch {
      // 原生接口异常（格式不支持等）不拦路，继续走 jsQR
    }
  }
  return decodeWithJsQr(source)
}
