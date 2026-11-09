import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ take: vi.fn(), ack: vi.fn(), update: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => bridge }))
vi.mock('@/lib/notify', () => ({ syncTaskNotification: vi.fn(), cancelTaskNotification: vi.fn() }))
import { db } from '@/db/db'
import { drainTaskWidgetActions, syncTaskWidget } from './taskWidget'

beforeEach(async () => {
  await db.delete(); await db.open(); vi.resetAllMocks()
  bridge.take.mockResolvedValue({ adds: [], checks: [] })
  bridge.ack.mockResolvedValue(undefined); bridge.update.mockResolvedValue(undefined)
})

it('确认操作与新快照一次交给原生，完成后不会短暂露出旧任务', async () => {
  await db.tasks.put({ id: 'a', title: '待完成', tier: 'today', priority: 2, status: 'todo', tags: [], createdAt: 1, updatedAt: 1 })
  bridge.take.mockResolvedValueOnce({ adds: [], checks: [{ id: 'a', at: 10 }] })
  await drainTaskWidgetActions()
  expect((await db.tasks.get('a'))?.status).toBe('done')
  const acknowledged = bridge.ack.mock.calls[0][0]
  expect(acknowledged.checks).toEqual([{ id: 'a', at: 10 }])
  expect(JSON.parse(acknowledged.payload).tasks).toEqual([])
  expect(bridge.update).not.toHaveBeenCalled()
})

it('合并动作期间不发布 React 读取的旧快照', async () => {
  let resume!: (value: { checks: { id: string; at: number }[] }) => void
  bridge.take.mockReturnValueOnce(new Promise(resolve => { resume = resolve }))
  const task = { id: 'a', title: '任务', tier: 'today' as const, priority: 2 as const, status: 'todo' as const, tags: [], createdAt: 1, updatedAt: 1 }
  await db.tasks.put(task)
  const draining = drainTaskWidgetActions()
  await syncTaskWidget([task])
  expect(bridge.update).not.toHaveBeenCalled()
  resume({ checks: [{ id: 'a', at: 10 }] })
  await draining
  expect(JSON.parse(bridge.ack.mock.calls[0][0].payload).tasks).toEqual([])
})

it('确认失败后重试，不重复增加打卡次数', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await db.tasks.put({ id: 'a', title: '喝水', tier: 'today', priority: 2, status: 'todo', tags: [], repeat: 'daily', repeatCount: 3, createdAt: 1, updatedAt: 1 })
  bridge.take.mockResolvedValueOnce({ checks: [{ id: 'a', at: 10 }] }).mockResolvedValueOnce({ checks: [{ id: 'a', at: 10 }] })
  bridge.ack.mockRejectedValueOnce(new Error('retry'))
  await drainTaskWidgetActions(); await drainTaskWidgetActions()
  expect((await db.tasks.get('a'))?.checkin?.count).toBe(1)
  expect(bridge.ack).toHaveBeenCalledTimes(2)
  warn.mockRestore()
})

it('待添加任务在同步期间被完成，继续合并下一批完成动作', async () => {
  bridge.take.mockResolvedValueOnce({ adds: [{ id: 'new', title: '新任务' }] })
    .mockResolvedValueOnce({ checks: [{ id: 'new', at: Date.now() }] })
  await drainTaskWidgetActions()
  expect((await db.tasks.get('new'))?.status).toBe('done')
  expect(bridge.ack).toHaveBeenCalledTimes(2)
  expect(JSON.parse(bridge.ack.mock.calls.at(-1)![0].payload).tasks).toEqual([])
})
