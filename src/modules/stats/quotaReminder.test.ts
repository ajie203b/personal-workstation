import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { isFutureTask } from '@/lib/date'
import { createSingleQuotaRenewTask, unlockLegacyQuotaRenewTasks } from './quotaReminder'

describe('quotaReminder', () => {
  beforeEach(async () => {
    await db.tasks.clear()
  })

  it('只创建一个可立即点击完成的续费提醒任务（含并发防重）', async () => {
    const today = '2026-11-28'
    const entry = { name: 'longcat2.5', expiresAt: '2026-11-30' }

    const [r1, r2] = await Promise.all([
      createSingleQuotaRenewTask(entry, today),
      createSingleQuotaRenewTask(entry, today),
    ])
    const r3 = await createSingleQuotaRenewTask(entry, today)

    expect(r1.created || r2.created).toBe(true)
    expect(r1.created && r2.created).toBe(false)
    expect(r3.created).toBe(false)

    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('续费检查：longcat2.5')
    expect(tasks[0].due).toBe('2026-11-30')
    expect(tasks[0].startAt).toBeTypeOf('number')
    expect(isFutureTask(tasks[0], today, Date.now() + 1000)).toBe(false)
  })

  it('自动解锁旧版缺少 startAt 导致无法点击完成的续费任务', async () => {
    const today = '2026-11-28'
    await db.tasks.add({
      id: 'legacy-1',
      title: '续费检查：longcat2.5',
      tier: 'today',
      priority: 1,
      status: 'todo',
      due: '2026-11-30',
      tags: ['额度续费'],
      createdAt: 1000,
      updatedAt: 1000,
    })

    const before = await db.tasks.get('legacy-1')
    expect(isFutureTask(before!, today)).toBe(true)

    const fixed = await unlockLegacyQuotaRenewTasks([before!], today)
    expect(fixed).toBe(1)

    const after = await db.tasks.get('legacy-1')
    expect(after?.startAt).toBe(1000)
    expect(isFutureTask(after!, today)).toBe(false)
  })
})
