import { db, type FanqieBook, type FanqieChapterRow } from './db'
import type { FanqieBookInfo, FanqieChapterMeta } from '@/lib/fanqie'

/** 首次解析时建/更新书架条目；已有章节数保留，不被新解析覆盖 */
export async function saveFanqieBook(info: FanqieBookInfo): Promise<FanqieBook> {
  const existing = await db.fanqieBooks.get(info.bookId)
  const now = Date.now()
  const downloadedCount = existing ? await countFanqieChapters(info.bookId) : 0
  const row: FanqieBook = {
    id: info.bookId,
    title: info.title,
    author: info.author,
    cover: info.cover,
    abstract: info.abstract,
    status: info.status,
    wordCount: info.wordCount,
    chapterCount: info.chapters.length || info.chapterCount,
    tags: info.tags,
    lastChapterTitle: info.lastChapterTitle,
    updatedAt: info.updatedAt,
    chapters: info.chapters,
    downloadedCount,
    createdAt: existing?.createdAt ?? now,
    savedAt: existing?.savedAt ?? now,
    lastError: existing?.lastError,
  }
  await db.fanqieBooks.put(row)
  return row
}

export function getFanqieBook(id: string): Promise<FanqieBook | undefined> {
  return db.fanqieBooks.get(id)
}

export function listFanqieBooks(): Promise<FanqieBook[]> {
  return db.fanqieBooks.orderBy('savedAt').reverse().toArray()
}

export function countFanqieChapters(bookId: string): Promise<number> {
  return db.fanqieChapters.where('bookId').equals(bookId).count()
}

export async function getDownloadedItemIds(bookId: string): Promise<Set<string>> {
  // 只取主键，不把每章正文都读进内存（大书几千章）
  const keys = await db.fanqieChapters.where('bookId').equals(bookId).primaryKeys()
  return new Set(
    keys.map((k) => {
      const s = String(k)
      const i = s.indexOf(':')
      return i >= 0 ? s.slice(i + 1) : s
    }),
  )
}

export function getFanqieChapterRows(bookId: string): Promise<FanqieChapterRow[]> {
  return db.fanqieChapters.where('bookId').equals(bookId).sortBy('index')
}

export async function saveFanqieChapter(
  bookId: string,
  meta: FanqieChapterMeta,
  content: string,
): Promise<void> {
  const row: FanqieChapterRow = {
    id: `${bookId}:${meta.itemId}`,
    bookId,
    itemId: meta.itemId,
    index: meta.index,
    title: meta.title,
    volume: meta.volume,
    content,
    savedAt: Date.now(),
  }
  await db.fanqieChapters.put(row)
}

export async function updateFanqieProgress(
  bookId: string,
  downloadedCount: number,
  lastError?: string,
): Promise<void> {
  await db.fanqieBooks.update(bookId, {
    downloadedCount,
    savedAt: Date.now(),
    lastError,
  })
}

export async function deleteFanqieBook(bookId: string): Promise<void> {
  await db.transaction('rw', [db.fanqieBooks, db.fanqieChapters], async () => {
    await db.fanqieChapters.where('bookId').equals(bookId).delete()
    await db.fanqieBooks.delete(bookId)
  })
}

/** 重下：清掉正文但保留书目与目录 */
export async function resetFanqieBook(bookId: string): Promise<void> {
  await db.transaction('rw', [db.fanqieBooks, db.fanqieChapters], async () => {
    await db.fanqieChapters.where('bookId').equals(bookId).delete()
    await db.fanqieBooks.update(bookId, {
      downloadedCount: 0,
      lastError: undefined,
      savedAt: Date.now(),
    })
  })
}
