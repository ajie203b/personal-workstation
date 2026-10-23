import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOnnxRunner } from './onnx'

type Listener = (event: { data?: unknown; message?: string }) => void

class FakeWorker {
  static mode: 'fail' | 'ready' = 'fail'
  static instances: FakeWorker[] = []

  onmessage: Listener | null = null
  onerror: Listener | null = null
  terminated = false
  private listeners = new Map<string, Set<Listener>>()

  constructor(public url: URL, public options?: unknown) {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }

  postMessage(msg: { type?: string; key?: string }) {
    if (msg.type !== 'init') return
    queueMicrotask(() => {
      const data = FakeWorker.mode === 'fail'
        ? { type: 'result', key: msg.key, ok: false, error: '模拟初始化失败' }
        : { type: 'ready', key: msg.key }
      this.emit('message', { data })
    })
  }

  terminate() {
    this.terminated = true
  }

  private emit(type: string, event: { data?: unknown }) {
    this.listeners.get(type)?.forEach((fn) => fn(event))
    if (type === 'message') this.onmessage?.(event)
  }
}

describe('OnnxRunner.prepare', () => {
  beforeEach(() => {
    FakeWorker.mode = 'fail'
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    getOnnxRunner('worker').dispose()
    vi.unstubAllGlobals()
  })

  it('初始化失败立即 reject，恢复后同一 key 可以重试', async () => {
    const runner = getOnnxRunner('worker')
    await expect(runner.prepare('ppocr-det', new ArrayBuffer(1))).rejects.toThrow('模拟初始化失败')

    FakeWorker.mode = 'ready'
    await expect(runner.prepare('ppocr-det', new ArrayBuffer(1))).resolves.toBeUndefined()
  })
})
