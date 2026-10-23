import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Task } from './db'
import { reorderTasks, sortTasks } from './tasks'

vi.mock('@/lib/notify', () => ({ syncTaskNotification: vi.fn() }))

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: id, tier: 'today', status: 'todo', priority: 2, tags: [], createdAt: 1, updatedAt: 1, ...patch,
})
beforeEach(async () => { await db.tasks.clear() })

describe('自定义任务顺序', () => {
  it('手动顺序优先于重要程度，未排序任务稳定追加', () => {
    expect(sortTasks([task('new', { priority: 0 }), task('b', { sortOrder: 1 }), task('a', { sortOrder: 0 })]).map(t => t.id))
      .toEqual(['a', 'b', 'new'])
  })
  it('保存拖动后的顺序，保留隐藏任务和任务内容', async () => {
    await db.tasks.bulkPut([task('a', { sortOrder: 0 }), task('hidden', { tier: 'someday', sortOrder: 1 }), task('b', { sortOrder: 2 }), task('c', { sortOrder: 3 })])
    await reorderTasks(['a', 'b', 'c'], 'c', 'a')
    expect(sortTasks(await db.tasks.toArray()).map(t => t.id)).toEqual(['c', 'hidden', 'a', 'b'])
    expect(await db.tasks.get('hidden')).toMatchObject({ tier: 'someday', title: 'hidden' })
  })
  it('取消拖动或落在自己身上不修改数据', async () => {
    await db.tasks.put(task('a'))
    await reorderTasks(['a'], 'a', 'a')
    expect((await db.tasks.get('a'))?.updatedAt).toBe(1)
  })
  it('拖出置顶区后落在指定位置，不被旧置顶标记弹回顶部', async () => {
    await db.tasks.bulkPut([task('a', { pinned: true }), task('b'), task('c')])
    await reorderTasks(['a', 'b', 'c'], 'a', 'c')
    expect(sortTasks(await db.tasks.toArray()).map(t => t.id)).toEqual(['b', 'c', 'a'])
    expect((await db.tasks.get('a'))?.pinned).toBeFalsy()
  })
})
