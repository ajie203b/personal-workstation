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
import type { MathNotePage } from '@/modules/tools/mathnotes/types'

const { db } = await import('./db')
const { exportAll, importAll } = await import('./tasks')

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
  it('备份和恢复保留模型额度卡片顺序与余额', async () => {
    const records = [{ id: 'a', name: '会员', sortOrder: 1, updatedAt: 2 }, { id: 'b', name: '余额', sortOrder: 0, displayMode: 'balance', balance: 28, balanceUnit: '元', updatedAt: 3 }]
    await db.settings.put({ key: 'aiQuotaEntries', value: records })
    const backup = await exportAll()
    await db.settings.delete('aiQuotaEntries')
    await importAll(backup, 'replace')
    expect((await db.settings.get('aiQuotaEntries'))?.value).toEqual(records)
  })

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

const note = (id: string, patch: Partial<MathNotePage> = {}): MathNotePage => ({
  id,
  title: `第 ${id} 页`,
  strokes: [
    { id: `${id}-s1`, width: 3, points: [{ x: 10.25, y: 20.5, p: 0.5, t: 1730000000000 }, { x: 15.75, y: 22, p: 0.62, t: 1730000000016 }, { x: 31, y: 40.1, p: 0.7, t: 1730000000033 }] },
    { id: `${id}-s2`, width: 2.5, points: [{ x: 100, y: 50, p: 0.5, t: 1730000001000 }] },
  ],
  results: [{ key: `${id}-s1|${id}-s2`, recognized: '1+1=', edited: '1+1=', result: { kind: 'inline', latex: '2', text: '2' } }],
  createdAt: 1000,
  updatedAt: 2000,
  ...patch,
})

describe('手写计算笔记的备份', () => {
  it('导出 → 清库 → 导入后笔迹与识别结果完整（坐标保留 0.1px）', async () => {
    const a = note('a')
    await db.mathNotes.bulkPut([a, note('b', { strokes: [], results: [] })])
    const backup = await exportAll()
    expect(JSON.parse(backup).mathNotes).toHaveLength(2)

    await db.mathNotes.clear()
    expect(await db.mathNotes.count()).toBe(0)
    await importAll(backup, 'replace')

    const back = await db.mathNotes.get('a')
    expect(back).toBeTruthy()
    expect(back!.title).toBe(a.title)
    expect(back!.results).toEqual(a.results)
    expect(back!.updatedAt).toBe(a.updatedAt)
    expect(back!.strokes.map((s) => [s.id, s.width, s.points.length])).toEqual(a.strokes.map((s) => [s.id, s.width, s.points.length]))
    a.strokes.forEach((s, i) => s.points.forEach((p, j) => {
      const q = back!.strokes[i].points[j]
      expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(0.0501)
      expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(0.0501)
      expect(Math.abs(q.p - p.p)).toBeLessThanOrEqual(0.0051)
      expect(q.t).toBe(p.t)
    }))
    expect(await db.mathNotes.get('b')).toMatchObject({ strokes: [], results: [] })
  })

  it('合并导入按 id 覆盖，不动本机其他笔记', async () => {
    await db.mathNotes.bulkPut([note('keep'), note('a', { title: '旧标题' })])
    await importAll(snapshot({ mathNotes: [note('a', { title: '新标题' })] }), 'merge')
    expect((await db.mathNotes.get('a'))?.title).toBe('新标题')
    expect(await db.mathNotes.get('keep')).toBeTruthy()
  })

  it('旧版备份没有 mathNotes 字段：导入不报错，也不清掉本机笔记', async () => {
    await db.mathNotes.put(note('local'))
    const r = await importAll(snapshot(), 'replace')
    expect(r.tasks).toBe(1)
    expect(await db.mathNotes.get('local')).toBeTruthy()
  })

  it('笔迹结构损坏：拒绝整份导入', async () => {
    await expect(importAll(snapshot({ mathNotes: [{ ...note('x'), strokes: [{ id: 's', width: 2, pts: [1, 2, 3] }] }] }))).rejects.toThrow(/mathNotes\[0\]\.strokes\[0\]\.pts/)
    expect(await db.tasks.count()).toBe(0)
  })

  it('紧凑编码明显比原始 JSON 小', async () => {
    const points = Array.from({ length: 2000 }, (_, i) => ({ x: 100 + i * 0.37123, y: 200 + Math.sin(i) * 13.3337, p: 0.4 + (i % 50) / 100, t: 1730000000000 + i * 8 }))
    const big = note('big', { strokes: [{ id: 's', width: 3, points }] })
    await db.mathNotes.put(big)
    const packed = JSON.stringify(JSON.parse(await exportAll()).mathNotes)
    expect(packed.length).toBeLessThan(JSON.stringify([big]).length / 2.5)
  })
})
