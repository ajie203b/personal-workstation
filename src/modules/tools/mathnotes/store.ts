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

/** 新建一页时落库（原样写入，updatedAt 用页面自带的创建时间） */
export async function createPage(page: MathNotePage): Promise<void> {
  await db.mathNotes.put(page)
}

export const CONFLICT_SUFFIX = '（冲突副本）'

export type CommitOutcome =
  /** 库里还是打开时那一版：已写入，updatedAt = 最后一次编辑的时间 */
  | { kind: 'saved'; page: MathNotePage }
  /** 库里这页已被同步更新 / 删除，本地只有派生改动（自动识别结果）：不写库，以库里的为准 */
  | { kind: 'stale'; latest: MathNotePage | undefined }
  /** 库里这页已被同步更新 / 删除，本地也编辑过：不覆盖对方，本地版本另存为一页冲突副本 */
  | { kind: 'conflict'; latest: MathNotePage | undefined; copy: MathNotePage }

/**
 * 乐观并发写入：baseline 是编辑器载入这一页时库里的 updatedAt。
 * 写入前在事务里比对库中当前值——同步可能已经把另一台设备的新版本写进来了，
 * 这时绝不能用旧编辑器里的内容覆盖它（更不能盖上一个更新的时间戳再同步出去）。
 *
 * updatedAt 取最后一次编辑的时间（而不是保存时间）；若本机时钟比对方慢，
 * 至少比 baseline 大 1，保证同步合并时这次编辑算「更新」。
 */
export async function commitPage(
  draft: MathNotePage,
  baseline: number,
  opts: { editedAt: number; userEdited: boolean; now?: number },
): Promise<CommitOutcome> {
  return db.transaction('rw', db.mathNotes, db.tombstones, async () => {
    const cur = await db.mathNotes.get(draft.id)
    const deleted = !cur || Boolean(await db.tombstones.get(draft.id))
    if (!deleted && cur.updatedAt === baseline) {
      const page = { ...draft, updatedAt: Math.max(opts.editedAt, baseline + 1) }
      await db.mathNotes.put(page)
      return { kind: 'saved', page }
    }
    const latest = deleted ? undefined : cur
    if (!opts.userEdited) return { kind: 'stale', latest }
    const now = opts.now ?? Date.now()
    const base = draft.title.endsWith(CONFLICT_SUFFIX) ? draft.title : `${draft.title}${CONFLICT_SUFFIX}`
    const copy: MathNotePage = {
      ...draft,
      id: uid(),
      title: base,
      // 排在原页后面
      createdAt: draft.createdAt + 1,
      updatedAt: Math.max(opts.editedAt, now),
    }
    await db.mathNotes.put(copy)
    return { kind: 'conflict', latest, copy }
  })
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
