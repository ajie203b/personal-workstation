import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runPdfJob } from './qpdfClient'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
}
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const input = new Uint8Array([1, 2, 3])
const job = { kind: 'compress', preset: 'lossless' } as const

it('取消会立即结束 Worker，不等待 WASM 返回', async () => {
  const controller = new AbortController()
  const promise = runPdfJob(input, job, { signal: controller.signal })
  const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
})
it('已取消任务不会创建 Worker', async () => {
  await expect(runPdfJob(input, job, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  expect(FakeWorker.instances).toHaveLength(0)
})
it('成功返回后清理 Worker 与超时定时器', async () => {
  const progress = vi.fn()
  const promise = runPdfJob(input, job, { onProgress: progress })
  const worker = FakeWorker.instances[0]
  worker.onmessage?.({ data: { type: 'progress', percent: 35, label: '处理中' } })
  worker.onmessage?.({ data: { type: 'result', result: { bytes: input } } })
  expect(await promise).toEqual({ bytes: input })
  expect(progress).toHaveBeenCalledWith({ percent: 35, label: '处理中' })
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('异常和超时均释放任务，错误不会包含运行时内部信息', async () => {
  const failed = runPdfJob(input, job)
  const caught = expect(failed).rejects.toThrow('PDF 引擎未能加载')
  FakeWorker.instances[0].onerror?.()
  await caught
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  const pending = runPdfJob(input, job)
  const timedOut = expect(pending).rejects.toThrow('处理超时')
  await vi.advanceTimersByTimeAsync(180000)
  await timedOut
  expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce()
})
