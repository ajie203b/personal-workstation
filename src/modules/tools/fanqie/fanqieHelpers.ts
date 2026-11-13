import type { FanqieBook } from '@/db/db'
import type { FanqieBookInfo } from '@/lib/fanqie'
import { FqwebError } from '@/lib/fanqieFqweb'

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function libraryToInfo(b: FanqieBook): FanqieBookInfo {
  return {
    bookId: b.id,
    title: b.title,
    author: b.author,
    cover: b.cover,
    abstract: b.abstract,
    status: b.status,
    statusKind: b.status.includes('完结') ? 'done' : b.status.includes('连载') ? 'serial' : 'unknown',
    wordCount: b.wordCount,
    chapterCount: b.chapterCount,
    tags: b.tags,
    lastChapterTitle: b.lastChapterTitle,
    updatedAt: b.updatedAt,
    chapters: b.chapters,
    fetchedAt: Date.now(),
    fontChanged: false,
  }
}

export function searchErrorMessage(e: unknown): string {
  if (e instanceof FqwebError) {
    switch (e.code) {
      case 'NOT_FOUND':
        return '没搜到这本书，换个书名或作者试试。'
      case 'UNAVAILABLE':
        return '在线服务暂时连不上，请稍后再试。'
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : '搜索失败'
}

export function bookErrorMessage(e: unknown): string {
  if (e instanceof FqwebError) {
    if (e.code === 'UNAVAILABLE') return '正文接口暂时连不上，稍后重试。'
    if (e.code === 'NOT_FOUND') return '没有拿到这本书的目录。'
    return e.message
  }
  return e instanceof Error ? e.message : '打开书籍失败'
}
