/// <reference lib="webworker" />
/** 唯一的 ComputeEngine 计算/绘图 Worker：承接单块计算、整页变量求值与函数曲线采样。 */
import { computeLatex } from './compute'
import { sampleCurves } from './plot'
import { evaluatePage } from './variables'
import type { WorkerIn, WorkerOut } from './workerProtocol'

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const msg = event.data
  if (msg.type !== 'compute' && msg.type !== 'plot' && msg.type !== 'evaluatePage') return
  try {
    if (msg.type === 'compute') {
      self.postMessage({ type: 'computed', id: msg.id, key: msg.key, result: computeLatex(msg.latex) } satisfies WorkerOut)
    } else if (msg.type === 'evaluatePage') {
      self.postMessage({ type: 'pageEvaluated', id: msg.id, evaluation: evaluatePage(msg.entries) } satisfies WorkerOut)
    } else {
      self.postMessage({
        type: 'plotted',
        id: msg.id,
        curves: sampleCurves(msg.latex, msg.min, msg.max, msg.count, msg.tMin, msg.tMax, msg.variables, msg.centerX, msg.centerY),
      } satisfies WorkerOut)
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, message: error instanceof Error ? error.message : String(error) } satisfies WorkerOut)
  }
}
