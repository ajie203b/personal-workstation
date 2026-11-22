import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { db } from './db'
import { addTask, rolloverTasks } from './tasks'

vi.mock('@/lib/notify', () => ({ syncTaskNotification: vi.fn() }))

it('批量撤销还原原清单和截止日，保留中途编辑并跳过已改期或删除的任务', async () => {
  const today = await addTask({ title: '无截止日', tier: 'today' })
  const overdue = await addTask({ title: '逾期', tier: 'anytime', due: '2026-01-10' })
  const changed = await addTask({ title: '另行改期', tier: 'today' })
  const deleted = await addTask({ title: '已删除', tier: 'today' })
  const { count, undo } = await rolloverTasks([today, overdue, changed, deleted], '2026-01-20')
  expect(count).toBe(4)
  expect(await db.tasks.get(today.id)).toMatchObject({ tier: 'upcoming', due: '2026-01-20' })

  await db.tasks.update(today.id, { title: '新标题' })
  await db.tasks.update(changed.id, { due: '2026-01-22' })
  await db.tasks.delete(deleted.id)
  expect(await undo()).toBe(2)
  const restored = await db.tasks.get(today.id)
  expect(restored).toMatchObject({ title: '新标题', tier: 'today' })
  expect(restored?.due).toBeUndefined()
  expect(await db.tasks.get(overdue.id)).toMatchObject({ tier: 'anytime', due: '2026-01-10' })
  expect(await db.tasks.get(changed.id)).toMatchObject({ tier: 'upcoming', due: '2026-01-22' })
  expect(await db.tasks.get(deleted.id)).toBeUndefined()
})
