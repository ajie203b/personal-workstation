import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import {
  cleanLegacyAiTables,
  cleanOrphanBlobs,
  purgeDocTrash,
  scanStorageBreakdown,
} from './storageDiagnostics'
import { getForceWasmMode, ONNX_FORCE_WASM_DB_KEY, setForceWasmMode } from './onnx'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('storageDiagnostics', () => {
  it('按模块统计空间并安全清理孤儿附件与全文索引', async () => {
    const activeBlob = new Blob(['a'.repeat(100)])
    const trashBlob = new Blob(['b'.repeat(60)])
    const orphanBlob = new Blob(['c'.repeat(80)])

    await db.docs.bulkPut([
      { id: 'd1', hash: 'h-active', title: '在库文档', kind: 'md', size: 100, addedAt: 1 },
      { id: 'd2', hash: 'h-trash', title: '回收站文档', kind: 'md', size: 60, addedAt: 2, deletedAt: 100 },
    ])
    await db.blobs.bulkPut([
      { hash: 'h-active', blob: activeBlob },
      { hash: 'h-trash', blob: trashBlob },
      { hash: 'h-orphan', blob: orphanBlob },
    ])
    await db.docText.bulkPut([
      { hash: 'h-active', kind: 'md', text: 'hello', indexedAt: 1 },
      { hash: 'h-orphan', kind: 'md', text: 'stale', indexedAt: 1 },
    ])

    const before = await scanStorageBreakdown()
    expect(before.activeDocCount).toBe(1)
    expect(before.activeBlobBytes).toBe(100)
    expect(before.trashDocCount).toBe(1)
    expect(before.trashBlobBytes).toBe(60)
    expect(before.orphanBlobCount).toBe(1)
    expect(before.orphanBlobBytes).toBe(80)

    const cleaned = await cleanOrphanBlobs()
    expect(cleaned).toEqual({ count: 1, bytes: 80 })
    expect(await db.blobs.get('h-orphan')).toBeUndefined()
    expect(await db.docText.get('h-orphan')).toBeUndefined()
    expect(await db.blobs.get('h-active')).toBeDefined()
    expect(await db.blobs.get('h-trash')).toBeDefined()
  })

  it('清空回收站会删除未共享附件并写墓碑，但保留仍被在库文档共享的附件', async () => {
    await db.docs.bulkPut([
      { id: 'active-shared', hash: 'h-shared', title: '正本', kind: 'pdf', size: 50, addedAt: 1 },
      { id: 'trash-shared', hash: 'h-shared', title: '副本回收站', kind: 'pdf', size: 50, addedAt: 2, deletedAt: 10 },
      { id: 'trash-only', hash: 'h-only', title: '独享回收站', kind: 'pdf', size: 120, addedAt: 3, deletedAt: 20 },
    ])
    await db.blobs.bulkPut([
      { hash: 'h-shared', blob: new Blob(['s'.repeat(50)]) },
      { hash: 'h-only', blob: new Blob(['o'.repeat(120)]) },
    ])
    await db.positions.put({ hash: 'h-only', progressPct: 0.4, updatedAt: 1 })
    await db.annotations.put({
      id: 'ann-1',
      docHash: 'h-only',
      text: '摘录',
      color: 'yellow',
      createdAt: 1,
    })
    await db.bookmarks.put({
      id: 'bm-1',
      docHash: 'h-only',
      label: '书签',
      anchor: 'p2',
      createdAt: 1,
    })

    const res = await purgeDocTrash()
    expect(res).toEqual({ count: 2, bytes: 120 })
    expect(await db.docs.get('active-shared')).toBeDefined()
    expect(await db.docs.get('trash-shared')).toBeUndefined()
    expect(await db.docs.get('trash-only')).toBeUndefined()
    // 共享附件必须保留
    expect(await db.blobs.get('h-shared')).toBeDefined()
    // 独享附件与附属记录已清理并写墓碑
    expect(await db.blobs.get('h-only')).toBeUndefined()
    expect(await db.positions.get('h-only')).toBeUndefined()
    expect(await db.annotations.get('ann-1')).toBeUndefined()
    expect(await db.bookmarks.get('bm-1')).toBeUndefined()
    expect(await db.tombstones.get('trash-only')).toBeDefined()
    expect(await db.tombstones.get('ann-1')).toBeDefined()
    expect(await db.tombstones.get('bm-1')).toBeDefined()
  })

  it('清理历史已下线的旧 AI 残表', async () => {
    await db.aiSessions.put({
      id: 's1',
      title: 'old',
      providerId: 'p1',
      model: 'gpt',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.aiMessages.put({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      state: 'done',
      createdAt: 1,
    })

    expect((await scanStorageBreakdown()).legacyAiCount).toBe(2)
    expect(await cleanLegacyAiTables()).toBe(2)
    expect((await scanStorageBreakdown()).legacyAiCount).toBe(0)
  })

  it('Force-WASM 安全模式写入 IndexedDB 供主线程与 Worker 读取', async () => {
    await setForceWasmMode(true)
    expect((await db.settings.get(ONNX_FORCE_WASM_DB_KEY))?.value).toBe(true)
    await setForceWasmMode(false)
    expect((await db.settings.get(ONNX_FORCE_WASM_DB_KEY))?.value).toBe(false)
    expect(getForceWasmMode()).toBe(false)
  })
})
