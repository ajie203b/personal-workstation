/**
 * 主线程侧的识别/计算客户端：把 Worker 消息包装成 Promise。
 * 一个页面一个实例；离开页面时 dispose（终止 Worker，模型缓存保留在 Cache Storage）。
 */
import type { ComputeResult, Stroke } from './types'
import type { ModelSourceConfig } from './recognizer'
import type { WorkerIn, WorkerOut } from './workerProtocol'

export interface RecognizedBlock {
  key: string
  latex: string
  confidence: number
  ms: number
  result: ComputeResult
}

type Pending = {
  resolve: (v: WorkerOut) => void
  reject: (e: Error) => void
  onProgress?: (ratio: number, file: string) => void
}

export class MathEngine {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private source: ModelSourceConfig | null = null
  /** 最近一次加载得到的推理后端 */
  backend: string | undefined

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./mathnotes.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data
      const p = this.pending.get(msg.id)
      if (!p) return
      if (msg.type === 'progress') {
        p.onProgress?.(msg.ratio, msg.file)
        return
      }
      this.pending.delete(msg.id)
      if (msg.type === 'error') p.reject(new Error(msg.message))
      else p.resolve(msg)
    }
    w.onerror = (e) => {
      const err = new Error(e.message || '识别进程异常退出')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      if (this.worker === w) this.worker = null
    }
    this.worker = w
    if (this.source) w.postMessage({ type: 'config', source: this.source } satisfies WorkerIn)
    return w
  }

  private request(msg: WorkerIn & { id: number }, onProgress?: Pending['onProgress']): Promise<WorkerOut> {
    const w = this.ensure()
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject, onProgress })
      w.postMessage(msg)
    })
  }

  setSource(source: ModelSourceConfig): void {
    this.source = source
    this.worker?.postMessage({ type: 'config', source } satisfies WorkerIn)
  }

  /** 下载并加载模型；返回推理后端名。fresh=true 先清本模型缓存（「重试 / 换源」） */
  async load(onProgress?: (ratio: number, file: string) => void, opts: { fresh?: boolean } = {}): Promise<string> {
    const out = await this.request({ type: 'load', id: this.nextId++, fresh: opts.fresh }, onProgress)
    this.backend = out.type === 'loaded' ? out.backend : 'wasm'
    return this.backend
  }

  async recognize(key: string, strokes: Stroke[], charHeight: number, onProgress?: (ratio: number, file: string) => void): Promise<RecognizedBlock> {
    const out = await this.request({ type: 'recognize', id: this.nextId++, key, strokes, charHeight }, onProgress)
    if (out.type !== 'recognized') throw new Error('识别返回异常')
    return { key: out.key, latex: out.latex, confidence: out.confidence, ms: out.ms, result: out.result }
  }

  async compute(key: string, latex: string): Promise<ComputeResult> {
    const out = await this.request({ type: 'compute', id: this.nextId++, key, latex })
    if (out.type !== 'computed') throw new Error('计算返回异常')
    return out.result
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new DOMException('已取消', 'AbortError'))
    this.pending.clear()
  }
}
