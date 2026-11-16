import { formatOcrLines } from './ocrPipeline'
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

const IDLE_DISPOSE_MS = 60_000
let sharedWorker: Worker | null = null
let idleTimer: number | null = null
let pendingQueue: Promise<void> = Promise.resolve()

/** 显式销毁复用中的后台 OCR Worker，释放 ONNX 推理内存 */
export function disposeOcrWorker(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (sharedWorker) {
    try {
      sharedWorker.terminate()
    } catch {
      /* ignore */
    }
    sharedWorker = null
  }
}

function scheduleIdleDispose(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => {
    disposeOcrWorker()
  }, IDLE_DISPOSE_MS)
}

function getSharedWorker(): Worker {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' })
  }
  return sharedWorker
}

/**
 * 复用本地 OCR Worker 识别 dataURL 图像（用于 PDF 区域截图一键识图）。
 * 在单次结束后保留热 Worker 与 ONNX 会话以便连续识图，空闲 60 秒后自动释放内存。
 */
export function recognizeImageDataUrl(
  dataUrl: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<{ lines: OcrLine[]; text: string }> {
  const runTask = async (): Promise<{ lines: OcrLine[]; text: string }> => {
    const px = await dataUrlToRgba(dataUrl)
    const id = Date.now() + Math.floor(Math.random() * 1000)
    const worker = getSharedWorker()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
      const onMessage = (e: MessageEvent) => {
        const msg = e.data as
          | { type: 'progress'; id: number; progress: OcrProgress }
          | { type: 'done'; id: number; lines: OcrLine[] }
          | { type: 'error'; id: number; message: string; aborted: boolean }
        if (msg.id !== id) return
        if (msg.type === 'progress') {
          onProgress?.(msg.progress)
          return
        }
        cleanup()
        scheduleIdleDispose()
        if (msg.type === 'done') {
          resolve({
            lines: msg.lines,
            text: formatOcrLines(msg.lines, 'smart').trim(),
          })
          return
        }
        reject(new Error(msg.message || 'OCR 识别失败'))
      }
      const onError = () => {
        cleanup()
        disposeOcrWorker()
        reject(new Error('OCR 识别进程异常退出'))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ type: 'run', id, width: px.width, height: px.height, rgba: px.data.buffer }, [px.data.buffer])
    })
  }

  const next = pendingQueue.then(runTask, runTask)
  pendingQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}
