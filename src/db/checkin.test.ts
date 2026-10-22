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

const { db } = await import('./db')
const { addTask, checkInTask, checkinProgress, toggleDone } = await import('./tasks')
const { todayStr } = await import('@/lib/date')

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const read = async (id: string) => {
  const t = await db.tasks.get(id)
  if (!t) throw new Error('任务不存在')
  return t
}

describe('新建任务的时间默认值', () => {
  it('没写开始时间 → 从现在开始', async () => {
    const before = Date.now()
    const t = await addTask({ title: '整理桌面', tier: 'anytime' })
    expect(t.startAt).toBeGreaterThanOrEqual(before)
    expect(t.startAt).toBeLessThanOrEqual(Date.now())
  })

  it('没写截止时间 → 无穷远（undefined，不参与逾期判断）', async () => {
    const t = await addTask({ title: '整理桌面', tier: 'anytime' })
    expect(t.due).toBeUndefined()
  })
})

describe('打卡次数（次数，不是次序）', () => {
  it('3 次：前两次只 +1，第三次才归档并生成下一次', async () => {
    const t = await addTask({ title: '喝水', tier: 'today', repeat: 'daily', repeatCount: 3, due: todayStr() })

    const r1 = await checkInTask(t)
    expect(r1).toMatchObject({ completed: false, count: 1, total: 3 })
    expect((await read(t.id)).status).toBe('todo')
    expect(checkinProgress(await read(t.id))).toEqual({ count: 1, total: 3 })

    const r2 = await checkInTask(await read(t.id))
    expect(r2).toMatchObject({ completed: false, count: 2, total: 3 })

    const r3 = await checkInTask(await read(t.id))
    expect(r3).toMatchObject({ completed: true, count: 3, total: 3 })
    expect((await read(t.id)).status).toBe('done')

    // 下一次任务带着同样的次数，进度从 0 开始
    expect(r3.spawned).not.toBeNull()
    const next = await read(r3.spawned!.id)
    expect(next.repeatCount).toBe(3)
    expect(next.checkin).toBeUndefined()
    expect(checkinProgress(next)).toEqual({ count: 0, total: 3 })
  })

  it('没设次数 = 一次即完成', async () => {
    const t = await addTask({ title: '打卡', tier: 'today', repeat: 'daily', due: todayStr() })
    const r = await checkInTask(t)
    expect(r).toMatchObject({ completed: true, count: 1, total: 1 })
    expect(r.spawned).not.toBeNull()
  })

  it('打卡时间点跟着下一周期走', async () => {
    const t = await addTask({
      title: '喝水', tier: 'today', repeat: 'daily', repeatCount: 2, due: todayStr(),
      dueTime: '08:00', repeatTimes: ['08:00', '21:00'],
    })
    await checkInTask(t)
    const r = await checkInTask(await read(t.id))
    const next = await read(r.spawned!.id)
    expect(next.repeatTimes).toEqual(['08:00', '21:00'])
    expect(next.dueTime).toBe('08:00')
  })

  it('跨周期自动归零：截止日变了，旧进度不算数', async () => {
    const t = await addTask({ title: '喝水', tier: 'today', repeat: 'daily', repeatCount: 5, due: todayStr() })
    await db.tasks.update(t.id, { checkin: { due: '2020-01-01', count: 4, at: 1 } })
    expect(checkinProgress(await read(t.id))).toEqual({ count: 0, total: 5 })
  })
})

describe('完成与恢复仍然兼容', () => {
  it('普通任务一次完成即可', async () => {
    const t = await addTask({ title: '交报告', tier: 'today' })
    const spawned = await toggleDone(t)
    expect(spawned).toBeNull()
    expect((await read(t.id)).status).toBe('done')
  })
})
