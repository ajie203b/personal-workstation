/**
 * ONNX 主线程封装（v3.3）：给证件照 / OCR 用。
 *
 * 用法：
 *   const runner = getOnnxRunner()
 *   await runner.prepare('modnet', modelBuffer)   // 首次建立 Worker 会话
 *   const out = await runner.run('modnet', { input: { type:'float32', data, dims } })
 */

export interface TensorData {
  type: 'float32' | 'int32' | 'int64' | 'uint8'
  data: Float32Array | Int32Array | Uint8Array | BigInt64Array
  dims: number[]
}

type Pending = {
  resolve: (v: Record<string, TensorData>) => void
  reject: (e: Error) => void
}

class OnnxRunner {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private ready = new Map<string, Promise<void>>()
  private nextId = 1

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./onnx.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'ready'; key: string }
        | { type: 'result'; id: number; ok: boolean; outputs?: Record<string, TensorData>; error?: string }
      if (msg.type === 'ready') return
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok && msg.outputs) p.resolve(msg.outputs)
      else p.reject(new Error(msg.error || '推理失败'))
    }
    // Worker 整体崩溃时，已经发出去的推理请求不能永远悬着
    worker.onerror = (e) => {
      const err = new Error(e.message || '推理进程异常退出')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.ready.clear()
      if (this.worker === worker) this.worker = null
    }
    this.worker = worker
    return worker
  }

  /** 加载模型并建会话；同 key 幂等 */
  async prepare(key: string, modelBuffer: ArrayBuffer): Promise<void> {
    const existing = this.ready.get(key)
    if (existing) return existing
    const worker = this.ensureWorker()
    const p = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
      const onMessage = (e: MessageEvent) => {
        const msg = e.data as { type?: string; key?: string; ok?: boolean; error?: string }
        if (msg.key !== key) return
        if (msg.type === 'ready') {
          cleanup()
          resolve()
          return
        }
        // init 失败没有 id，靠 key 归位；不接住的话界面会卡在「下载模型 100%」
        if (msg.type === 'result' && msg.ok === false) {
          cleanup()
          reject(new Error(msg.error || '模型加载失败'))
        }
      }
      const onError = (e: ErrorEvent) => {
        cleanup()
        reject(new Error(e.message || '模型加载失败'))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ type: 'init', key, modelBuffer }, [modelBuffer])
    })
    this.ready.set(key, p)
    // 失败的 Promise 不能留在缓存里，否则同一页面重试还会拿到旧错误
    void p.catch(() => {
      if (this.ready.get(key) === p) this.ready.delete(key)
    })
    return p
  }

  /** 跑一次推理（模型须已 prepare） */
  run(key: string, inputs: Record<string, TensorData>): Promise<Record<string, TensorData>> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ type: 'run', id, key, inputs })
    })
  }
  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.ready.clear()
  }
}

let singleton: OnnxRunner | null = null

export function getOnnxRunner(): OnnxRunner {
  return (singleton ??= new OnnxRunner())
}
