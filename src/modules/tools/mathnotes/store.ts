/** 数学笔记的本地存储（Dexie mathNotes 表 + settings 里的下载源配置）；笔记进 JSON 备份 / 自动快照 / WebDAV 同步 */
import { db } from '@/db/db'
import { uid } from '@/lib/id'
import { markDeleted } from '@/lib/tombstones'
import type { MathNotePage } from './types'
import { DEFAULT_SOURCE, type ModelSourceConfig } from './recognizer'

const SOURCE_KEY = 'mathNotesModelSource'
const LAST_PAGE_KEY = 'mathNotesLastPage'

export function newPage(index: number): MathNotePage {
  const now = Date.now()
  return { id: uid(), title: `第 ${index} 页`, strokes: [], results: [], createdAt: now, updatedAt: now }
}

export async function listPages(): Promise<MathNotePage[]> {
  return db.mathNotes.orderBy('updatedAt').toArray().then((rows) => rows.sort((a, b) => a.createdAt - b.createdAt))
}

export async function savePage(page: MathNotePage): Promise<void> {
  await db.mathNotes.put({ ...page, updatedAt: Date.now() })
}

/** 删除同时记墓碑：笔记参与 WebDAV 同步，没有墓碑的话另一台设备会把它推回来 */
export async function deletePage(id: string): Promise<void> {
  await db.transaction('rw', db.mathNotes, db.tombstones, async () => {
    await db.mathNotes.delete(id)
    await markDeleted(id)
  })
}

export async function getSource(): Promise<ModelSourceConfig> {
  const row = await db.settings.get(SOURCE_KEY)
  const v = row?.value as ModelSourceConfig | undefined
  return v && typeof v === 'object' && 'preferred' in v ? v : DEFAULT_SOURCE
}

export async function setSource(cfg: ModelSourceConfig): Promise<void> {
  await db.settings.put({ key: SOURCE_KEY, value: cfg })
}

/** 上次停留的页只记在本机（localStorage），不随 settings 同步 */
export function getLastPageId(): string | undefined {
  try {
    return localStorage.getItem(LAST_PAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function setLastPageId(id: string): void {
  try {
    localStorage.setItem(LAST_PAGE_KEY, id)
  } catch {
    /* 隐私模式等不可写时忽略 */
  }
}
