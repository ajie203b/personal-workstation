import { describe, expect, it } from 'vitest'
import type { Bookmark, Doc, SettingKV, Task } from '@/db/db'
import { mergePayloads, type SyncPayload } from './syncMerge'

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: `任务 ${id}`, tier: 'today', priority: 2, status: 'todo', tags: [],
  createdAt: 1000, updatedAt: 1000, ...patch,
})

const doc = (id: string, patch: Partial<Doc> = {}): Doc => ({
  id, hash: `h-${id}`, title: `文档 ${id}`, kind: 'pdf', size: 10, addedAt: 1000, ...patch,
})

const bookmark = (id: string, patch: Partial<Bookmark> = {}): Bookmark => ({
  id, docHash: 'h', label: id, anchor: 'p1', createdAt: 1000, updatedAt: 1000, ...patch,
})

function payload(patch: Partial<SyncPayload> = {}): SyncPayload {
  return {
    app: 'personal-workstation',
    version: 4,
    exportedAt: '2026-10-20T00:00:00.000Z',
    tasks: [], settings: [], docs: [], positions: [], annotations: [],
    bookmarks: [], focusSessions: [], folders: [], tombstones: [], blobMeta: [], ...patch,
  }
}

describe('mergePayloads', () => {
  it('没有远端时原样返回', () => {
    const local = payload({ tasks: [task('a')] })
    const r = mergePayloads(local, null)
    expect(r.replaceAll).toBe(false)
    expect(r.payload.tasks).toHaveLength(1)
    expect(r.payload.exportedAt).not.toBe(local.exportedAt)
  })

  it('同一 id 取更新时间更晚的一份', () => {
    const r = mergePayloads(
      payload({ tasks: [task('a', { title: '旧', updatedAt: 100 })] }),
      payload({ tasks: [task('a', { title: '新', updatedAt: 200 })] }),
    )
    expect(r.payload.tasks[0].title).toBe('新')
  })

  it('本地更新时保留本地', () => {
    const r = mergePayloads(
      payload({ tasks: [task('a', { title: '本地新', updatedAt: 300 })] }),
      payload({ tasks: [task('a', { title: '远端旧', updatedAt: 200 })] }),
    )
    expect(r.payload.tasks[0].title).toBe('本地新')
  })

  it('墓碑优先：两端都删掉，不会被推回来', () => {
    const r = mergePayloads(
      payload({ tasks: [task('a')], tombstones: [{ id: 'a', ts: 900 }] }),
      payload({ tasks: [task('a', { updatedAt: 2000 })] }),
    )
    expect(r.payload.tasks).toHaveLength(0)
    expect(r.payload.tombstones).toContainEqual({ id: 'a', ts: 900 })
  })

  it('远端墓碑删掉本地记录', () => {
    const r = mergePayloads(
      payload({ bookmarks: [bookmark('b1')] }),
      payload({ tombstones: [{ id: 'b1', ts: 5000 }] }),
    )
    expect(r.payload.bookmarks).toHaveLength(0)
  })

  it('设置项本地优先，远端独有的补进来', () => {
    const local: SettingKV[] = [{ key: 'themeMode', value: 'dark' }]
    const remote: SettingKV[] = [{ key: 'themeMode', value: 'light' }, { key: 'density', value: 'large' }]
    const r = mergePayloads(payload({ settings: local }), payload({ settings: remote }))
    const map = new Map(r.payload.settings.map((s) => [s.key, s.value]))
    expect(map.get('themeMode')).toBe('dark')
    expect(map.get('density')).toBe('large')
  })

  it('文档按 addedAt 取新（内容不可变，保留先出现的元信息）', () => {
    const r = mergePayloads(
      payload({ docs: [doc('d1', { addedAt: 100, title: '旧标题' })] }),
      payload({ docs: [doc('d1', { addedAt: 200, title: '新标题' })] }),
    )
    expect(r.payload.docs[0].title).toBe('新标题')
  })

  it('批注没有 updatedAt 时按 createdAt 比较', () => {
    const r = mergePayloads(
      payload({ annotations: [{ id: 'a1', docHash: 'h', text: '旧', color: 'yellow', createdAt: 1 }] }),
      payload({ annotations: [{ id: 'a1', docHash: 'h', text: '新', color: 'blue', createdAt: 2 }] }),
    )
    expect(r.payload.annotations[0].text).toBe('新')
  })

  it('本地清空过（纪元更大）→ 整份以本地为准', () => {
    const r = mergePayloads(
      payload({ epoch: 5000, tasks: [] }),
      payload({ epoch: 1000, tasks: [task('old')] }),
    )
    expect(r.replaceAll).toBe(true)
    expect(r.payload.tasks).toHaveLength(0)
  })

  it('远端清空过 → 整份以远端为准，本地需要清空重写', () => {
    const r = mergePayloads(
      payload({ epoch: 1000, tasks: [task('old')] }),
      payload({ epoch: 5000, tasks: [] }),
    )
    expect(r.replaceAll).toBe(true)
    expect(r.payload.tasks).toHaveLength(0)
    expect(r.payload.epoch).toBe(5000)
  })

  it('文档本体清单取并集', () => {
    const r = mergePayloads(
      payload({ blobMeta: [{ hash: 'a', type: 'application/pdf' }] }),
      payload({ blobMeta: [{ hash: 'b', type: 'image/png' }] }),
    )
    expect(r.payload.blobMeta.map((m) => m.hash).sort()).toEqual(['a', 'b'])
  })
})
