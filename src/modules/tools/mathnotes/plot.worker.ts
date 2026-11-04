/// <reference lib="webworker" />
import { sampleCurves } from './plot'
import { evaluatePage } from './variables'
import type { WorkerIn, WorkerOut } from './workerProtocol'
self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const msg = event.data
  if (msg.type !== 'plot' && msg.type !== 'evaluatePage') return
  try {
    if (msg.type === 'evaluatePage') self.postMessage({ type: 'pageEvaluated', id: msg.id, evaluation: evaluatePage(msg.entries) } satisfies WorkerOut)
    else self.postMessage({ type: 'plotted', id: msg.id, curves: sampleCurves(msg.latex, msg.min, msg.max, msg.count, msg.tMin, msg.tMax, msg.variables, msg.centerX, msg.centerY) } satisfies WorkerOut)
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, message: error instanceof Error ? error.message : String(error) } satisfies WorkerOut)
  }
}
