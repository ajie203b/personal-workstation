import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { linkLocalMarkdown } from './localMarkdownLibrary'
import { exportSnapshotParts } from '@/db/tasks'
vi.mock('@/lib/docTextIndex', () => ({ indexDoc: async () => {} }))
vi.mock('@/lib/localMarkdown', async original => ({ ...await original<typeof import('@/lib/localMarkdown')>(), localMarkdown: { image: async () => 'data:image/png;base64,AQ==' } }))
beforeEach(async () => { await db.delete(); await db.open() })

it('普通阅读不导入，主动关联后重复操作复用同一篇文档', async () => {
  const path = 'D:/私有笔记/文章.md'
  expect(await linkLocalMarkdown(path, '# 内容')).toBeNull()
  expect(await db.docs.count()).toBe(0)
  const [first, second] = await Promise.all([linkLocalMarkdown(path, '# 内容', true), linkLocalMarkdown(path, '# 内容', true)])
  expect(first?.id).toBe(second?.id)
  expect(await db.docs.count()).toBe(1)
  expect((await exportSnapshotParts()).json).not.toContain(path)
})

it('外部正文改变后更新文档快照并保留高亮关联', async () => {
  const first = (await linkLocalMarkdown('D:/a.md', '# 第一版', true))!
  await db.annotations.put({ id: 'a', docHash: first.hash, text: '第一版', color: 'yellow', blockIdx: 0, createdAt: 1 })
  const next = (await linkLocalMarkdown('D:/a.md', '# 第二版'))!
  expect(next.id).toBe(first.id)
  expect(next.hash).not.toBe(first.hash)
  expect((await db.annotations.get('a'))?.docHash).toBe(next.hash)
})

it('关联文档快照包含本地图片，再次浏览不重复改动版本', async () => {
  const doc = (await linkLocalMarkdown('D:/a.md', '# 图文\n\n![说明](images/a.png)', true))!
  const stored = await db.blobs.get(doc.hash)
  expect(await stored!.blob.text()).toContain('data:image/png;base64,AQ==')
  expect((await linkLocalMarkdown('D:/a.md', '# 图文\n\n![说明](images/a.png)'))?.updatedAt).toBe(doc.updatedAt)
})
