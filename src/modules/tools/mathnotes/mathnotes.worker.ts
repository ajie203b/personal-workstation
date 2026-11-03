/// <reference lib="webworker" />
/**
 * 手写计算 Worker：模型下载/加载、识别推理、Compute Engine 计算都关在这里，
 * 主线程只管画布手感。推理会话直接在本 Worker 内联创建（lib/onnx 的 InlineOnnxRunner），
 * 不再嵌套 Worker（Tauri 的 asset 协议不允许）。
 *
 * 所有请求串行执行：同一时刻只跑一个推理，避免两个块同时识别把手机内存顶满。
 */
import { getOnnxRunner, type InlineOnnxRunner } from '@/lib/onnx'
import { Pix2TextMfrRecognizer } from './pix2textMfr'
import { rasterizeStrokes } from './preprocess'
import { computeLatex } from './compute'
import type { ModelSourceConfig } from './recognizer'
import type { WorkerIn, WorkerOut } from './workerProtocol'

const runner = getOnnxRunner() as InlineOnnxRunner
const recognizer = new Pix2TextMfrRecognizer({ runtime: runner })

let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => undefined)
  return next
}

const post = (msg: WorkerOut) => self.postMessage(msg)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  if (msg.type === 'config') {
    recognizer.setSource(msg.source as ModelSourceConfig)
    return
  }
  void enqueue(async () => {
    try {
      if (msg.type === 'load') {
        await recognizer.load((p) => post({ type: 'progress', id: msg.id, ratio: p.ratio, file: p.file }))
        post({ type: 'loaded', id: msg.id, backend: recognizer.backend ?? 'wasm' })
        return
      }
      if (msg.type === 'recognize') {
        await recognizer.load((p) => post({ type: 'progress', id: msg.id, ratio: p.ratio, file: p.file }))
        const image = rasterizeStrokes(msg.strokes, msg.charHeight)
        const out = await recognizer.recognize(image)
        const result = computeLatex(out.latex)
        post({ type: 'recognized', id: msg.id, key: msg.key, latex: out.latex, confidence: out.confidence, ms: out.ms, result })
        return
      }
      if (msg.type === 'compute') {
        post({ type: 'computed', id: msg.id, key: msg.key, result: computeLatex(msg.latex) })
      }
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
    }
  })
}
