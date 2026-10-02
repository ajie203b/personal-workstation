import { db, type Annotation, type Doc, type DocKind, type DocSettings, type ReadingPosition } from './db'
import { uid } from '@/lib/id'

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

/** 导入文档：内容去重（同 hash 复用），文件本体存 blobs */
export async function importDoc(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer()
  const hash = await hashBuffer(buf)
  const existing = await db.docs.where('hash').equals(hash).first()
  if (existing) return { doc: existing, duplicated: true }

  const ext = file.name.toLowerCase()
  const kind: DocKind = ext.endsWith('.pdf') ? 'pdf' : 'md'
  const title = file.name.replace(/\.(pdf|md|markdown|txt)$/i, '')
  const doc: Doc = {
    id: uid(),
    hash,
    title,
    kind,
    size: file.size,
    addedAt: Date.now(),
  }
  await db.transaction('rw', db.docs, db.blobs, async () => {
    await db.blobs.put({ hash, blob: new Blob([buf], { type: file.type || 'application/octet-stream' }) })
    await db.docs.add(doc)
  })
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

export async function deleteDoc(doc: Doc): Promise<void> {
  await db.transaction('rw', db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, async () => {
    await db.docs.delete(doc.id)
    await db.blobs.delete(doc.hash)
    await db.positions.delete(doc.hash)
    const anns = await db.annotations.where('docHash').equals(doc.hash).toArray()
    await db.annotations.bulkDelete(anns.map((a) => a.id))
    const marks = await db.bookmarks.where('docHash').equals(doc.hash).toArray()
    await db.bookmarks.bulkDelete(marks.map((b) => b.id))
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
  const pos = (await db.positions.get(hash)) ?? { hash, updatedAt: 0 }
  await db.positions.put({ ...pos, hash, settings, updatedAt: Date.now() })
}

/* ============ 批注与书签 ============ */

export async function addAnnotation(input: Omit<Annotation, 'id' | 'createdAt'>): Promise<Annotation> {
  const ann: Annotation = { ...input, id: uid(), createdAt: Date.now() }
  await db.annotations.add(ann)
  return ann
}

export async function updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void> {
  await db.annotations.update(id, patch)
}

export async function deleteAnnotation(id: string): Promise<void> {
  await db.annotations.delete(id)
}

export async function addBookmark(docHash: string, label: string, anchor: string): Promise<void> {
  await db.bookmarks.add({ id: uid(), docHash, label, anchor, createdAt: Date.now() })
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id)
}

/* ============ 批注 → 任务（互跳） ============ */

/** 批注一键转任务：携带引用深链与摘录（方案 2.5） */
export async function annotationToTask(ann: Annotation, doc: Doc, priority?: 0 | 1 | 2 | 3): Promise<string> {
  const { addTask } = await import('./tasks')
  const anchor = doc.kind === 'pdf' ? `p${ann.page}` : `b${ann.blockIdx}`
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
