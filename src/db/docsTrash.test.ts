import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db, type Doc } from './db'
import { deleteDoc, restoreDoc, purgeDoc, emptyDocTrash } from './docs'
import { setDocFolder } from './folders'

const doc: Doc = { id: 'a', hash: 'content', title: '测试文档', kind: 'md', size: 5, addedAt: 1, folderId: 'folder' }
beforeEach(async () => {
  await db.delete(); await db.open()
  await db.docs.put(doc)
  await db.blobs.put({ hash: doc.hash, blob: new Blob(['hello']) })
  await db.annotations.put({ id: 'ann', docHash: doc.hash, text: 'hello', color: 'yellow', createdAt: 1 })
  await db.positions.put({ hash: doc.hash, progressPct: .5, updatedAt: 1 })
})

it('删除只进入回收站，恢复保留正文、批注和阅读位置，原夹不存在则回到未分类', async () => {
  await deleteDoc(doc)
  expect((await db.docs.get(doc.id))?.deletedAt).toBeGreaterThan(0)
  expect(await db.blobs.get(doc.hash)).toBeDefined()
  expect(await db.tombstones.get(doc.id)).toBeUndefined()
  await restoreDoc(doc.id)
  expect((await db.docs.get(doc.id))?.deletedAt).toBeUndefined()
  expect((await db.docs.get(doc.id))?.folderId).toBeUndefined()
  expect((await db.positions.get(doc.hash))?.progressPct).toBe(.5)
  expect(await db.annotations.get('ann')).toBeDefined()
})

it('移动更新同步时间，恢复优先放回仍存在的文件夹', async () => {
  await db.folders.put({ id: 'folder', name: '资料', createdAt: 1, updatedAt: 1 })
  await setDocFolder(doc.id, 'folder')
  expect((await db.docs.get(doc.id))?.updatedAt).toBeGreaterThan(1)
  await deleteDoc(doc); await restoreDoc(doc.id)
  expect((await db.docs.get(doc.id))?.folderId).toBe('folder')
})

it('彻底删除清除关联数据并立墓碑，共用本体的文档仍可恢复', async () => {
  await db.docs.put({ ...doc, id: 'b' })
  await deleteDoc(doc); await purgeDoc(doc.id)
  expect(await db.docs.get(doc.id)).toBeUndefined()
  expect(await db.tombstones.get(doc.id)).toBeDefined()
  expect(await db.annotations.get('ann')).toBeDefined()
  expect(await db.blobs.get(doc.hash)).toBeDefined()
  await deleteDoc({ ...doc, id: 'b' }); await emptyDocTrash()
  expect(await db.blobs.get(doc.hash)).toBeUndefined()
  expect(await db.annotations.get('ann')).toBeUndefined()
})

it('清空回收站不会删除未被放进回收站的文档', async () => {
  await purgeDoc(doc.id); await emptyDocTrash()
  expect(await db.docs.get(doc.id)).toBeDefined()
})
