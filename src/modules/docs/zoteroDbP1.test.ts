import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Annotation, type Doc } from '@/db/db'
import { updateDocMeta } from '@/db/docs'
import { createFolder, deleteFolder, moveFolder } from '@/db/folders'
import { validateSnapshot } from '@/db/snapshotSchema'
import { buildAnnotationMarkdown } from './exportAnnotations'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('Zotero P1 DB & snapshot compatibility', () => {
  it('supports nested folders, cycle guard, and reparents children on delete', async () => {
    const root = await createFolder('研究')
    const sub = await createFolder('AI', undefined, root.id)
    const leaf = await createFolder('RAG', undefined, sub.id)
    const doc: Doc = { id: 'd1', hash: 'h1', title: 'Doc 1', kind: 'pdf', size: 10, addedAt: 1, folderId: sub.id }
    await db.docs.put(doc)

    // 不能把父夹移动到其子孙下（防成环）
    await moveFolder(root.id, leaf.id)
    expect((await db.folders.get(root.id))?.parentId).toBeUndefined()

    // 删除中间节点 sub：sub 的子夹 leaf 应提升挂到 root 下，sub 下的文档回到未分类
    await deleteFolder(sub.id)
    expect(await db.folders.get(sub.id)).toBeUndefined()
    expect((await db.folders.get(leaf.id))?.parentId).toBe(root.id)
    expect((await db.docs.get('d1'))?.folderId).toBeUndefined()
  })

  it('updates literature metadata and keeps snapshot schema backward compatible', async () => {
    const doc: Doc = { id: 'd2', hash: 'h2', title: 'Old Title', kind: 'pdf', size: 10, addedAt: 100 }
    await db.docs.put(doc)
    await updateDocMeta('d2', {
      title: 'Attention Paper',
      starred: true,
      readStatus: 'reading',
      tags: ['llm', 'transformer'],
      meta: { author: 'Vaswani', year: '2017', venue: 'NeurIPS', doi: '10.5555/1' },
    })
    const saved = await db.docs.get('d2')
    expect(saved?.title).toBe('Attention Paper')
    expect(saved?.starred).toBe(true)
    expect(saved?.readStatus).toBe('reading')
    expect(saved?.tags).toEqual(['llm', 'transformer'])
    expect(saved?.meta?.doi).toBe('10.5555/1')

    // 旧版无 meta/tags/starred/parentId 字段 + 新版含这些字段都必须校验通过
    const snap = validateSnapshot({
      app: 'personal-workstation',
      version: 4,
      tasks: [],
      folders: [
        { id: 'f1', name: '旧夹', createdAt: 1, updatedAt: 1 },
        { id: 'f2', name: '子夹', parentId: 'f1', createdAt: 2, updatedAt: 2 },
      ],
      docs: [
        { id: 'old', hash: 'ho', title: 'Legacy', kind: 'md', size: 2, addedAt: 1 },
        saved!,
      ],
    })
    expect(snap.data.folders).toHaveLength(2)
    expect((snap.data.docs as Doc[])?.[1].meta?.venue).toBe('NeurIPS')
  })

  it('builds annotation markdown with page deep-links and citation line', async () => {
    const doc: Doc = {
      id: 'd3',
      hash: 'h3',
      title: 'Paper X',
      kind: 'pdf',
      size: 10,
      addedAt: 10,
      meta: { author: 'Alice', year: '2025' },
    }
    const anns: Annotation[] = [
      { id: 'a1', docHash: 'h3', page: 4, text: 'Key finding', color: 'yellow', createdAt: 10, comment: 'important' },
      { id: 'a2', docHash: 'h3', kind: 'shot', img: 'data:image/jpeg;base64,xx', page: 2, text: 'OCR formula x=1', color: 'blue', createdAt: 20 },
    ]
    const md = await buildAnnotationMarkdown(doc, anns)
    expect(md).toContain('> 来源引用：[Paper X](#/docs/d3) (Alice, 2025)')
    expect(md).toContain('## 第 2 页')
    expect(md).toContain('## 第 4 页')
    expect(md).toContain('#/docs/d3?p=p4&hl=a1')
    expect(md).toContain('> OCR formula x=1')
    expect(md).toContain('评论：important')
  })
})
