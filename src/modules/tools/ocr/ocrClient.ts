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

const IDLE_DISPOSE_MS = 180_000
let sharedWorker: Worker | null = null
let idleTimer: number | null = null
let pendingQueue: Promise<void> = Promise.resolve()
let activeRunId = 0
let activeAbort: (() => void) | null = null

/** 显式销毁复用中的后台 OCR Worker，释放 ONNX 推理内存 */
export function disposeOcrWorker(): void {
  const abort = activeAbort
  activeAbort = null
  abort?.()
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (sharedWorker) {
    try {
      sharedWorker.postMessage({ type: 'cancel', id: activeRunId })
    } catch {
      /* ignore */
    }
    try {
      sharedWorker.terminate()
    } catch {
      /* ignore */
    }
    sharedWorker = null
  }
}

/** 取消当前排队或进行中的 OCR 任务（协作取消 + 必要时重建 Worker） */
export function cancelActiveOcr(): void {
  if (activeAbort) {
    const abort = activeAbort
    activeAbort = null
    abort()
  }
  if (sharedWorker && activeRunId) {
    try {
      sharedWorker.postMessage({ type: 'cancel', id: activeRunId })
    } catch {
      /* ignore */
    }
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
 * 统一共享 OCR Worker 的像素识别入口（OcrPage 与 PDF 区域截图共用同一热 Worker，
 * 避免双 Worker 占用双份 ONNX 内存；空闲 3 分钟自动销毁释放内存）。
 */
export function recognizePixelsOnSharedWorker(
  px: { data: Uint8ClampedArray; width: number; height: number },
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<OcrLine[]> {
  const runTask = async (): Promise<OcrLine[]> => {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const id = ++activeRunId
    const worker = getSharedWorker()
    return new Promise<OcrLine[]>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
        if (activeAbort === onAbort) activeAbort = null
      }
      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        try {
          worker.postMessage({ type: 'cancel', id })
        } catch {
          /* ignore */
        }
        // 若用户硬取消推理中的 Worker，直接销毁以避免下次识别等旧任务排空
        if (sharedWorker === worker) {
          worker.terminate()
          sharedWorker = null
        }
        reject(new DOMException('已取消', 'AbortError'))
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
        if (settled) return
        settled = true
        cleanup()
        scheduleIdleDispose()
        if (msg.type === 'done') {
          resolve(msg.lines)
          return
        }
        if (msg.aborted) {
          reject(new DOMException('已取消', 'AbortError'))
          return
        }
        reject(new Error(msg.message || 'OCR 识别失败'))
      }
      const onError = () => {
        if (settled) return
        settled = true
        cleanup()
        if (sharedWorker === worker) {
          worker.terminate()
          sharedWorker = null
        }
        reject(new Error('OCR 识别进程异常退出，请重试'))
      }
      activeAbort = onAbort
      signal?.addEventListener('abort', onAbort, { once: true })
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

/**
 * 复用本地 OCR Worker 识别 dataURL 图像（用于 PDF 区域截图一键识图）。
 * 在单次结束后保留热 Worker 与 ONNX 会话以便连续识图，空闲 3 分钟后自动释放内存。
 */
export async function recognizeImageDataUrl(
  dataUrl: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<{ lines: OcrLine[]; text: string }> {
  const px = await dataUrlToRgba(dataUrl)
  const lines = await recognizePixelsOnSharedWorker(px, onProgress)
  return {
    lines,
    text: formatOcrLines(lines, 'smart').trim(),
  }
}
