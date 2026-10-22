import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 任务写入链会经过 notify.ts（原生通知），node 环境下换成空实现
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: async () => undefined,
    schedule: async () => undefined,
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
  },
}))

const { db } = await import('@/db/db')
const { addTask } = await import('@/db/tasks')
const { completeById } = await import('./taskActions')
const { todayStr } = await import('@/lib/date')

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('小组件勾选 completeById（与列表勾选同一套语义）', () => {
  it('普通任务：一次完成', async () => {
    const t = await addTask({ title: '写周报', tier: 'today', due: todayStr() })
    await completeById(t.id)
    expect((await db.tasks.get(t.id))?.status).toBe('done')
  })

  it('打卡任务：前两次只 +1，第三次打满才归档', async () => {
    const t = await addTask({ title: '喝水', tier: 'today', repeat: 'daily', repeatCount: 3, due: todayStr() })
    await completeById(t.id)
    await completeById(t.id)
    const mid = await db.tasks.get(t.id)
    expect(mid?.status).not.toBe('done')
    expect(mid?.checkin?.count).toBe(2)
    await completeById(t.id)
    expect((await db.tasks.get(t.id))?.status).toBe('done')
  })

  it('未来任务：拦下来不完成', async () => {
    const t = await addTask({ title: '明天才开始', tier: 'anytime', startAt: Date.now() + 86_400_000 })
    await completeById(t.id)
    expect((await db.tasks.get(t.id))?.status).not.toBe('done')
  })

  it('已经完成 / 不存在的 id：不炸也不重复归档', async () => {
    const t = await addTask({ title: '已完成的', tier: 'today', due: todayStr() })
    await completeById(t.id)
    await completeById(t.id)
    expect((await db.tasks.get(t.id))?.status).toBe('done')
    await expect(completeById('missing-id')).resolves.toBeUndefined()
  })
})
