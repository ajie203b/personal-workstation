import type { OcrLine, OcrProgress } from './ocrEngine'

async function dataUrlToRgba(dataUrl: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('截图解码失败'))
    el.src = dataUrl
  })
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) throw new Error('图像尺寸为空')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布上下文不可用')
  ctx.drawImage(img, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height)
  return { data: pixels.data, width, height }
}

/**
 * 复用本地 OCR Worker 识别 dataURL 图像（用于 PDF 区域截图一键识图）。
 * 在 Worker 结束后自动 terminate 释放推理内存，保留 IndexedDB/Cache 模型缓存。
 */
export async function recognizeImageDataUrl(
  dataUrl: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<{ lines: OcrLine[]; text: string }> {
  const px = await dataUrlToRgba(dataUrl)
  const id = Date.now() + Math.floor(Math.random() * 1000)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => {
      try {
        worker.terminate()
      } catch {
        /* ignore */
      }
    }
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'progress'; id: number; progress: OcrProgress }
        | { type: 'done'; id: number; lines: OcrLine[] }
        | { type: 'error'; id: number; message: string; aborted: boolean }
      if (msg.id !== id) return
      if (msg.type === 'progress') {
        onProgress?.(msg.progress)
        return
      }
      finish()
      if (msg.type === 'done') {
        resolve({
          lines: msg.lines,
          text: msg.lines.map((l) => l.text).join('\n').trim(),
        })
        return
      }
      reject(new Error(msg.message || 'OCR 识别失败'))
    }
    worker.onerror = () => {
      finish()
      reject(new Error('OCR 识别进程异常退出'))
    }
    worker.postMessage({ type: 'run', id, width: px.width, height: px.height, rgba: px.data.buffer }, [px.data.buffer])
  })
}
