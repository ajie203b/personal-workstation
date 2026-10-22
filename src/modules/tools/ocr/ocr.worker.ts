/// <reference lib="webworker" />
/**
 * 本地 OCR Worker（v3.3）：图像解码后的像素进来，识别结果出去。
 *
 * 之所以关在 Worker 里：det/rec 推理 + DB 后处理在大图上是几百毫秒级，
 * 放主线程会卡 UI。取消是协作式的——收 'cancel' 后在下一检查点抛 AbortError；
 * 主线程也可以直接 terminate 兜底（模型缓存不受影响，下次重下或命中缓存）。
 */
import { runOcr, type OcrLine, type OcrProgress } from './ocrEngine'

interface RunMsg {
  type: 'run'
  id: number
  width: number
  height: number
  /** RGBA 像素，transfer 进来 */
  rgba: ArrayBuffer
}

interface CancelMsg {
  type: 'cancel'
  id: number
}

type InMsg = RunMsg | CancelMsg

type OutMsg =
  | { type: 'progress'; id: number; progress: OcrProgress }
  | { type: 'done'; id: number; lines: OcrLine[]; width: number; height: number }
  | { type: 'error'; id: number; message: string; aborted: boolean }

const abortedIds = new Set<number>()

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    abortedIds.add(msg.id)
    return
  }
  const { id, width, height, rgba } = msg
  const signal = {
    get aborted() {
      return abortedIds.has(id)
    },
  }
  try {
    const result = await runOcr(
      { data: new Uint8ClampedArray(rgba), width, height },
      {
        signal,
        onProgress: (progress) => {
          const out: OutMsg = { type: 'progress', id, progress }
          self.postMessage(out)
        },
      },
    )
    const out: OutMsg = { type: 'done', id, lines: result.lines, width, height }
    self.postMessage(out)
  } catch (err) {
    abortedIds.delete(id)
    const isAbort = err instanceof DOMException && err.name === 'AbortError'
    const out: OutMsg = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      aborted: isAbort,
    }
    self.postMessage(out)
  }
}
