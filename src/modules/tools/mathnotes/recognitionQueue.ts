/**
 * 识别调度队列（主线程侧，纯逻辑，可单测）。
 *
 * - Worker 里同一时刻最多只有一个识别请求：只在上一个完成（空闲）时才发下一个；
 * - submit() 传入「当前笔迹下需要识别的块」的最新快照，整体替换尚未发出的请求：
 *   笔画变化后旧 key 不在快照里，对应请求直接取消，不再占着 Worker 推理；
 * - 已经在跑的请求跑完后由调用方自行判断是否过时并丢弃；
 * - 识别抛错（非 AbortError）记为该块失败：打日志、回调 onError，之后不会自动重试，
 *   直到 retry(key)；失败块的 key 不再出现在快照里（笔画变了）时失败标记自动清除。
 */

export interface RecognitionJob {
  key: string
}

export interface RecognitionQueueOptions<J extends RecognitionJob> {
  /** 队列状态变化（排队数 / 在跑 / 失败）时回调，用来刷新界面 */
  onChange?: () => void
  onError?: (job: J, error: unknown) => void
  logger?: Pick<Console, 'error'>
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError'
}

export class RecognitionQueue<J extends RecognitionJob> {
  private pending = new Map<string, J>()
  private running: J | null = null
  private failures = new Map<string, string>()
  private disposed = false

  constructor(
    private readonly run: (job: J) => Promise<void>,
    private readonly opts: RecognitionQueueOptions<J> = {},
  ) {}

  /** 排队 + 在跑的请求数 */
  get busy(): number {
    return this.pending.size + (this.running ? 1 : 0)
  }
  get runningKey(): string | null {
    return this.running?.key ?? null
  }
  pendingKeys(): string[] {
    return [...this.pending.keys()]
  }
  failureOf(key: string): string | undefined {
    return this.failures.get(key)
  }

  /** 以最新快照替换尚未发出的请求（同一块只保留最新版本，过时的直接取消） */
  submit(jobs: J[]): void {
    if (this.disposed) return
    const keys = new Set(jobs.map((j) => j.key))
    for (const k of [...this.failures.keys()]) if (!keys.has(k)) this.failures.delete(k)
    const next = new Map<string, J>()
    for (const j of jobs) {
      if (j.key === this.running?.key) continue
      if (this.failures.has(j.key)) continue
      next.set(j.key, j)
    }
    this.pending = next
    this.opts.onChange?.()
    this.pump()
  }

  /** 清除某块的失败标记；调用方随后 submit 即会重新识别 */
  retry(key: string): void {
    if (this.failures.delete(key)) this.opts.onChange?.()
  }

  dispose(): void {
    this.disposed = true
    this.pending.clear()
    this.failures.clear()
  }

  private pump(): void {
    if (this.disposed || this.running) return
    const first = this.pending.entries().next()
    if (first.done) return
    const [key, job] = first.value
    this.pending.delete(key)
    this.running = job
    this.opts.onChange?.()
    let p: Promise<void>
    try {
      p = this.run(job)
    } catch (e) {
      p = Promise.reject(e)
    }
    p.catch((e: unknown) => {
      if (isAbort(e) || this.disposed) return
      const message = e instanceof Error ? e.message : String(e)
      ;(this.opts.logger ?? console).error('[mathnotes] 识别失败', job.key, e)
      this.failures.set(job.key, message || '识别失败')
      this.opts.onError?.(job, e)
    }).finally(() => {
      this.running = null
      if (this.disposed) return
      this.opts.onChange?.()
      this.pump()
    })
  }
}
