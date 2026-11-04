/**
 * 主线程侧的识别/计算客户端：把 Worker 消息包装成 Promise。
 * 一个页面一个实例；离开页面时 dispose（终止 Worker，模型缓存保留在 Cache Storage）。
 */
import type { ComputeResult, Stroke } from './types'
import type { ModelSourceConfig } from './recognizer'
import type { WorkerIn, WorkerOut } from './workerProtocol'
import type { PlotCurve } from './plot'
import type { PageEntry, PageEvaluation } from './variables'

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
  private plotWorker: Worker | null = null
  private plotPending = new Map<number, Pending>()
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

  /** 下载并加载模型；返回推理后端名。fresh=true 先释放会话并清掉未通过校验的缓存文件（「重试 / 重新加载模型」） */
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

  private async secondaryRequest(makeMessage: (id: number) => WorkerIn): Promise<WorkerOut> {
    if (!this.plotWorker) {
      const worker = new Worker(new URL('./plot.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<WorkerOut>) => {
        const msg = event.data
        const pending = this.plotPending.get(msg.id)
        if (!pending) return
        this.plotPending.delete(msg.id)
        if (msg.type === 'error') pending.reject(new Error(msg.message)); else pending.resolve(msg)
      }
      worker.onerror = (event) => {
        for (const pending of this.plotPending.values()) pending.reject(new Error(event.message || '绘图进程异常退出'))
        this.plotPending.clear()
        worker.terminate()
        if (this.plotWorker === worker) this.plotWorker = null
      }
      this.plotWorker = worker
    }
    const id = this.nextId++
    const worker = this.plotWorker
    const out = await new Promise<WorkerOut>((resolve, reject) => {
      this.plotPending.set(id, { resolve, reject })
      try { worker.postMessage(makeMessage(id)) }
      catch (error) { this.plotPending.delete(id); reject(error) }
    })
    return out
  }


  async evaluatePage(entries: PageEntry[]): Promise<PageEvaluation> {
    const out = await this.secondaryRequest(id => ({ type: 'evaluatePage', id, entries }))
    if (out.type !== 'pageEvaluated') throw new Error('变量计算失败')
    return out.evaluation
  }

  async plot(latex: string, min: number, max: number, count = 241, tMin?: number, tMax?: number, variables?: Record<string, number>, centerX?: number, centerY?: number): Promise<PlotCurve[]> {
    const out = await this.secondaryRequest(id => ({ type: 'plot', id, latex, min, max, count, tMin, tMax, variables, centerX, centerY }))
    if (out.type !== 'plotted') throw new Error('函数图像计算失败')
    return out.curves
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.plotWorker?.terminate()
    this.plotWorker = null
    for (const pending of this.plotPending.values()) pending.reject(new DOMException('已取消', 'AbortError'))
    this.plotPending.clear()
    for (const p of this.pending.values()) p.reject(new DOMException('已取消', 'AbortError'))
    this.pending.clear()
  }
}
