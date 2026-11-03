import { describe, expect, it, vi } from 'vitest'
import { RecognitionQueue } from './recognitionQueue'

type Job = { key: string }

/** 可手动完成的假识别：记录每次开跑的 key */
function fakeRunner() {
  const started: string[] = []
  const waiters = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>()
  const run = (job: Job) =>
    new Promise<void>((resolve, reject) => {
      started.push(job.key)
      waiters.set(job.key, { resolve, reject })
    })
  const settle = async (key: string, err?: unknown) => {
    const w = waiters.get(key)!
    if (err) w.reject(err)
    else w.resolve()
    // 等 catch / finally 链跑完
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  return { run, started, settle }
}

describe('RecognitionQueue（过时识别不占队列，回归）', () => {
  it('同一时刻只发一个；执行期间不断变化的块只保留最新版本，过时请求不执行', async () => {
    const r = fakeRunner()
    const q = new RecognitionQueue<Job>(r.run)
    q.submit([{ key: 'a1' }])
    expect(r.started).toEqual(['a1'])
    // 用户继续写：块 a 的 key 依次变成 a2、a3、a4（a1 还在推理）
    q.submit([{ key: 'a2' }])
    q.submit([{ key: 'a3' }])
    q.submit([{ key: 'a4' }])
    expect(q.pendingKeys()).toEqual(['a4'])
    expect(q.busy).toBe(2)
    await r.settle('a1')
    // a2、a3 被直接取消，从未进入推理
    expect(r.started).toEqual(['a1', 'a4'])
    await r.settle('a4')
    expect(q.busy).toBe(0)
  })

  it('多个块按快照顺序依次识别；快照里已消失的块取消', async () => {
    const r = fakeRunner()
    const q = new RecognitionQueue<Job>(r.run)
    q.submit([{ key: 'a' }, { key: 'b' }, { key: 'c' }])
    q.submit([{ key: 'a' }, { key: 'c' }])
    await r.settle('a')
    await r.settle('c')
    expect(r.started).toEqual(['a', 'c'])
  })

  it('正在跑的 key 再次提交不会重复排队', async () => {
    const r = fakeRunner()
    const q = new RecognitionQueue<Job>(r.run)
    q.submit([{ key: 'a' }])
    q.submit([{ key: 'a' }])
    expect(q.pendingKeys()).toEqual([])
    await r.settle('a')
    expect(r.started).toEqual(['a'])
  })

  it('空快照（换页）清空等待中的请求', async () => {
    const r = fakeRunner()
    const q = new RecognitionQueue<Job>(r.run)
    q.submit([{ key: 'a' }, { key: 'b' }])
    q.submit([])
    await r.settle('a')
    expect(r.started).toEqual(['a'])
    expect(q.busy).toBe(0)
  })
})

describe('RecognitionQueue（推理失败不再静默，回归）', () => {
  it('失败记到该块、打日志、回调；不自动重试；retry 后重新识别', async () => {
    const r = fakeRunner()
    const logger = { error: vi.fn() }
    const onError = vi.fn()
    const q = new RecognitionQueue<Job>(r.run, { logger, onError })
    q.submit([{ key: 'a' }])
    await r.settle('a', new Error('onnx 推理崩了'))
    expect(q.failureOf('a')).toBe('onnx 推理崩了')
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith({ key: 'a' }, expect.any(Error))
    // 下一轮调度仍包含该块，但不会自动重跑
    q.submit([{ key: 'a' }])
    expect(r.started).toEqual(['a'])
    // 用户点失败标记重试
    q.retry('a')
    expect(q.failureOf('a')).toBeUndefined()
    q.submit([{ key: 'a' }])
    expect(r.started).toEqual(['a', 'a'])
    await r.settle('a')
    expect(q.failureOf('a')).toBeUndefined()
  })

  it('run 同步抛错也算失败，队列继续往下走', async () => {
    const started: string[] = []
    const q = new RecognitionQueue<Job>((job) => {
      started.push(job.key)
      if (job.key === 'bad') throw new Error('boom')
      return Promise.resolve()
    }, { logger: { error: () => {} } })
    q.submit([{ key: 'bad' }, { key: 'ok' }])
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(started).toEqual(['bad', 'ok'])
    expect(q.failureOf('bad')).toBe('boom')
  })

  it('AbortError（离开页面）不算失败', async () => {
    const r = fakeRunner()
    const logger = { error: vi.fn() }
    const q = new RecognitionQueue<Job>(r.run, { logger })
    q.submit([{ key: 'a' }])
    await r.settle('a', new DOMException('已取消', 'AbortError'))
    expect(q.failureOf('a')).toBeUndefined()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('笔画变化后（key 不在快照里）失败标记自动清除', async () => {
    const r = fakeRunner()
    const q = new RecognitionQueue<Job>(r.run, { logger: { error: () => {} } })
    q.submit([{ key: 'a' }])
    await r.settle('a', new Error('x'))
    q.submit([{ key: 'a2' }])
    expect(q.failureOf('a')).toBeUndefined()
    expect(r.started).toEqual(['a', 'a2'])
  })
})
