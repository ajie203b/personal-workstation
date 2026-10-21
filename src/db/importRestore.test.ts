import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 导入链会经过 notify.ts（原生通知），node 环境下换成空实现
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: async () => undefined,
    schedule: async () => undefined,
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
  },
}))

import type { Task } from './db'

const { db } = await import('./db')
const { importAll } = await import('./tasks')

const task: Task = { id: 't1', title: '读书', tier: 'today', priority: 2, status: 'todo', tags: [], createdAt: 1, updatedAt: 1 }

const snapshot = (patch: Record<string, unknown> = {}) => JSON.stringify({
  app: 'personal-workstation', version: 4, tasks: [task], settings: [], docs: [],
  positions: [], annotations: [], bookmarks: [], folders: [], tombstones: [], focusSessions: [], blobRows: [],
  ...patch,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('恢复快照', () => {
  it('保留本机专属设置（WebDAV 口令、同步时间戳不被清掉）', async () => {
    await db.settings.put({ key: 'webdav', value: { url: 'https://dav.test/mine', username: 'u', password: 'p', auto: true } })
    await db.settings.put({ key: 'lastSyncAt', value: 42 })

    const r = await importAll(
      snapshot({
        settings: [
          { key: 'webdav', value: { url: 'https://other.test', username: 'x', password: 'y', auto: false } },
          { key: 'lastSyncAt', value: 1 },
          { key: 'themeMode', value: 'dark' },
        ],
      }),
      'replace',
    )

    expect(r.tasks).toBe(1)
    // 本机口令与时间戳原样保留
    expect((await db.settings.get('webdav'))?.value).toMatchObject({ url: 'https://dav.test/mine' })
    expect((await db.settings.get('lastSyncAt'))?.value).toBe(42)
    // 备份负责的设置照常写入
    expect((await db.settings.get('themeMode'))?.value).toBe('dark')
  })

  it('替换语义：快照之后新建的记录消失（本机设置除外）', async () => {
    await db.tasks.put({ ...task, id: 'after' })
    await db.settings.put({ key: 'webdav', value: { url: 'https://dav.test', username: '', password: '', auto: false } })

    await importAll(snapshot(), 'replace')

    expect(await db.tasks.get('after')).toBeUndefined()
    expect(await db.tasks.get('t1')).toBeTruthy()
    expect(await db.settings.get('webdav')).toBeTruthy()
  })
})

describe('导入校验', () => {
  it('应用标识不对：拒绝并且一条都不写', async () => {
    await expect(importAll(snapshot({ app: 'someone-else' }), 'replace')).rejects.toThrow(/应用标识/)
    expect(await db.tasks.count()).toBe(0)
  })

  it('未知版本：拒绝', async () => {
    await expect(importAll(snapshot({ version: 99 }), 'replace')).rejects.toThrow(/不支持的版本/)
    expect(await db.tasks.count()).toBe(0)
  })

  it('任务标题写成数字：拒绝，脏数据不入库', async () => {
    await expect(importAll(snapshot({ tasks: [{ ...task, title: 123 }] }))).rejects.toThrow(/title 应为字符串/)
    expect(await db.tasks.count()).toBe(0)
  })

  it('坏 JSON 给出人话', async () => {
    await expect(importAll('{oops', 'replace')).rejects.toThrow(/不是合法 JSON/)
  })
})
