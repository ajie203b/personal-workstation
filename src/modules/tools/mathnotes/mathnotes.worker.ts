/// <reference lib="webworker" />
/**
 * 手写识别 Worker（纯 ONNX 推理）：模型下载/加载、笔迹识别都关在这里，
 * 主线程只管画布手感；符号计算与绘图统一收拢在 plot.worker.ts，避免双 Worker 重复打包 ComputeEngine。
 *
 * 所有请求串行执行：同一时刻只跑一个推理，避免两个块同时识别把手机内存顶满。
 */
import { getOnnxRunner, type InlineOnnxRunner } from '@/lib/onnx'
import { Pix2TextMfrRecognizer } from './pix2textMfr'
import { rasterizeStrokes } from './preprocess'
import { recognizeInk } from './inkRecognize'
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
        if (msg.fresh) await recognizer.reset()
        await recognizer.load((p) => post({ type: 'progress', id: msg.id, ratio: p.ratio, file: p.file }))
        post({ type: 'loaded', id: msg.id, backend: recognizer.backend ?? 'wasm' })
        return
      }
      if (msg.type === 'recognize') {
        await recognizer.load((p) => post({ type: 'progress', id: msg.id, ratio: p.ratio, file: p.file }))
        const out = await recognizeInk(msg.strokes, msg.charHeight, (strokes) =>
          recognizer.recognize(rasterizeStrokes(strokes, msg.charHeight)))
        post({
          type: 'recognizedRaw',
          id: msg.id,
          key: msg.key,
          latex: out.latex,
          confidence: out.confidence,
          ms: out.ms,
          incompleteSystem: out.incompleteSystem,
        })
      }
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
    }
  })
}
