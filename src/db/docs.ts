import { db, type Annotation, type Doc, type DocKind, type DocSettings, type ReadingPosition } from './db'
import { annotationAnchor } from '@/lib/docLocator'
import { uid } from '@/lib/id'
import { markDeleted } from '@/lib/tombstones'

/** SHA-256 内容指纹；非安全上下文降级为 FNV-1a */
async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  try {
    if (crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buf)
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* 降级 */
  }
  let h = 0x811c9dc5
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return `fnv-${(h >>> 0).toString(16)}-${bytes.length}`
}

export interface ImportResult {
  doc: Doc
  duplicated: boolean
}

/** 导入文档：内容去重（同 hash 复用），文件本体存 blobs；异步建全文索引 */
export async function importDoc(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer()
  const hash = await hashBuffer(buf)
  const existing = await db.docs.where('hash').equals(hash).first()
  if (existing) return { doc: existing, duplicated: true }

  const { detectKind } = await import('@/lib/docTextIndex')
  const kind: DocKind = detectKind(file.name)
  const title = file.name.replace(/\.(pdf|md|markdown|txt|epub|docx|pptx)$/i, '')
  const doc: Doc = {
    id: uid(),
    hash,
    title,
    kind,
    size: file.size,
    addedAt: Date.now(),
    updatedAt: Date.now(),
  }
  const blob = new Blob([buf], { type: file.type || 'application/octet-stream' })
  await db.transaction('rw', db.docs, db.blobs, async () => {
    // 事务内复检（防并发导入同文件产生双行）
    const recheck = await db.docs.where('hash').equals(hash).first()
    if (recheck) return
    await db.blobs.put({ hash, blob })
    await db.docs.add(doc)
  })
  // 全文索引异步抽取，不阻塞导入返回
  void import('@/lib/docTextIndex').then(({ indexDoc }) => indexDoc(doc, blob))
  return { doc, duplicated: false }
}

export async function getDocBlob(hash: string): Promise<Blob | undefined> {
  const row = await db.blobs.get(hash)
  return row?.blob
}

export async function touchDoc(id: string): Promise<void> {
  const doc = await db.docs.get(id)
  // 1 分钟内的重复打开不重复写，避免 liveQuery 风暴
  if (!doc || (doc.lastOpenedAt ?? 0) > Date.now() - 60_000) return
  await db.docs.update(id, { lastOpenedAt: Date.now() })
}

/* ============ Markdown 编辑保存 ============ */

/**
 * Markdown 内容的版本哈希。
 *
 * 为什么不能复用旧 hash：文档本体按 hash 寻址，WebDAV 同步只上传「远端没有的 hash」。
 * 旧实现保存时一直写回 `doc.hash`，内容变了 hash 没变 → 第二次同步直接跳过上传，
 * 远端永远停在第一次的正文。现在 hash 由「文档 id + 内容摘要」决定：
 * 同一篇文档内容一改就换 hash，同步才会把它当新本体上传。
 */
export function mdContentHash(docId: string, text: string): string {
  let h = 0x811c9dc5
  let g = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h = Math.imul(h ^ c, 0x01000193)
    g = Math.imul(g ^ c, 0x85ebca6b)
  }
  return `md-${docId}-${(h >>> 0).toString(16)}${(g >>> 0).toString(16)}`
}

/**
 * 保存 Markdown 文档（新建或覆盖）。内容变化时换 hash，并把按 hash 关联的
 * 阅读位置 / 批注 / 书签 / 全文索引一起迁到新 hash 上——否则正文换了，批注就全成了孤儿。
 */
export async function saveMarkdownDoc(input: {
  doc: Doc | null
  title: string
  markdown: string
}): Promise<Doc> {
  const { markdown } = input
  const now = Date.now()
  const title = input.title.trim() || input.doc?.title || '无标题文档'
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const id = input.doc?.id ?? uid()
  const hash = mdContentHash(id, markdown)
  const old = input.doc

  if (!old) {
    const doc: Doc = { id, hash, title, kind: 'md', size: markdown.length, addedAt: now, updatedAt: now, lastOpenedAt: now }
    await db.transaction('rw', db.docs, db.blobs, async () => {
      await db.blobs.put({ hash, blob })
      await db.docs.add(doc)
    })
    void import('@/lib/docTextIndex').then(({ indexDoc }) => indexDoc(doc, blob))
    return doc
  }

  const next: Doc = { ...old, hash, title, size: markdown.length, updatedAt: now, lastOpenedAt: now }

  if (old.hash === hash) {
    await db.docs.put(next)
    return next
  }

  await db.transaction(
    'rw',
    [db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.docText],
    async () => {
      await db.blobs.put({ hash, blob })
      await db.docs.put(next)

      // 旧 hash 只被这一篇文档引用时才迁移关联数据，避免把另一篇同内容文档的批注「搬走」
      const sharedWithOthers = (await db.docs.where('hash').equals(old.hash).count()) > 0
      if (!sharedWithOthers) {
        const pos = await db.positions.get(old.hash)
        if (pos) {
          await db.positions.put({ ...pos, hash, updatedAt: now })
          await db.positions.delete(old.hash)
        }
        const anns = await db.annotations.where('docHash').equals(old.hash).toArray()
        for (const a of anns) await db.annotations.update(a.id, { docHash: hash })
        const marks = await db.bookmarks.where('docHash').equals(old.hash).toArray()
        for (const b of marks) await db.bookmarks.update(b.id, { docHash: hash })
        await db.docText.delete(old.hash)
        await db.blobs.delete(old.hash)
      }
    },
  )
  void import('@/lib/docTextIndex').then(({ indexDoc }) => indexDoc(next, blob))
  return next
}

export async function deleteDoc(doc: Doc): Promise<void> {
  await db.transaction('rw', [db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.docText, db.tombstones], async () => {
    await db.docs.delete(doc.id)
    const otherRefs = await db.docs.where('hash').equals(doc.hash).count()
    if (otherRefs === 0) {
      await db.blobs.delete(doc.hash)
      await db.docText.delete(doc.hash)
    }
    await db.positions.delete(doc.hash)
    const anns = await db.annotations.where('docHash').equals(doc.hash).toArray()
    await db.annotations.bulkDelete(anns.map((a) => a.id))
    const marks = await db.bookmarks.where('docHash').equals(doc.hash).toArray()
    await db.bookmarks.bulkDelete(marks.map((b) => b.id))
    // 文档连同它的批注/书签一起立墓碑，否则另一台设备同步时会把它们推回来
    await markDeleted(doc.id, ...anns.map((a) => a.id), ...marks.map((b) => b.id))
  })
}

/* ============ 双坐标阅读位置 ============ */

export async function getPosition(hash: string): Promise<ReadingPosition | undefined> {
  return db.positions.get(hash)
}

/** 滚动时原子化更新双坐标（rw 事务串行化，避免并发读改写互相覆盖；无行则创建） */
export async function saveScrollAndProgress(
  hash: string,
  top: number,
  progress: NonNullable<ReadingPosition['progress']> | null,
  progressPct: number,
): Promise<void> {
  await db.transaction('rw', db.positions, async () => {
    const pos = (await db.positions.get(hash)) ?? { hash, updatedAt: 0 }
    pos.hash = hash
    pos.lastScroll = { top, at: Date.now() }
    if (progress) {
      pos.progress = progress
      pos.progressPct = progressPct
    }
    pos.updatedAt = Date.now()
    await db.positions.put(pos)
  })
}

/** 沉浸排版设置（按文档记忆） */
export async function saveDocSettings(hash: string, settings: DocSettings): Promise<void> {
  await db.transaction('rw', db.positions, async () => {
    const pos = (await db.positions.get(hash)) ?? { hash, updatedAt: 0 }
    pos.settings = settings
    pos.updatedAt = Date.now()
    await db.positions.put(pos)
  })
}

/* ============ 批注与书签 ============ */

export async function addAnnotation(input: Omit<Annotation, 'id' | 'createdAt'>): Promise<Annotation> {
  const now = Date.now()
  const ann: Annotation = { ...input, id: uid(), createdAt: now, updatedAt: now }
  await db.annotations.add(ann)
  return ann
}

export async function updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void> {
  // updatedAt 决定同步时谁新：评论、改色、复习进度都靠它
  await db.annotations.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteAnnotation(id: string): Promise<void> {
  await db.transaction('rw', [db.annotations, db.tombstones], async () => {
    await db.annotations.delete(id)
    await markDeleted(id)
  })
}

export async function addBookmark(docHash: string, label: string, anchor: string, quote?: string): Promise<void> {
  const now = Date.now()
  await db.bookmarks.add({ id: uid(), docHash, label, anchor, quote, createdAt: now, updatedAt: now })
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.transaction('rw', [db.bookmarks, db.tombstones], async () => {
    await db.bookmarks.delete(id)
    await markDeleted(id)
  })
}

/* ============ 批注 → 任务（互跳） ============ */

/** 批注一键转任务：携带引用深链与摘录（方案 2.5） */
export async function annotationToTask(ann: Annotation, doc: Doc, priority?: 0 | 1 | 2 | 3): Promise<string> {
  const { addTask } = await import('./tasks')
  const anchor = annotationAnchor(doc, ann)
  const task = await addTask({
    title: ann.text.length > 40 ? `${ann.text.slice(0, 40)}…` : ann.text,
    tier: 'anytime',
    priority: priority ?? 2,
    tags: ['批注'],
    notes: ann.comment ? `批注：${ann.comment}` : undefined,
  })
  await db.tasks.update(task.id, { docRef: { docId: doc.id, anchor: `${anchor}#${ann.id}`, label: doc.title } })
  return task.id
}
