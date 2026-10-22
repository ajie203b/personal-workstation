import { db, type Annotation, type AiMessage, type AiSession, type AiUsageRow, type Bookmark, type Doc, type DocText, type FocusSession, type Priority, type ReadingPosition, type Folder, type SettingKV, type Task, type Tier, type Tombstone } from './db'
import type { Table } from 'dexie'
import { uid } from '@/lib/id'
import { addDaysStr, parseDateStr, todayStr } from '@/lib/date'
import { nextDueForRepeat } from '@/lib/repeat'
import { syncTaskNotification } from '@/lib/notify'
import { markDeleted } from '@/lib/tombstones'
import { validateSnapshot } from './snapshotSchema'

export interface NewTaskInput {
  title: string
  tier: Tier
  priority?: Priority
  due?: string
  dueTime?: string
  tags?: string[]
  notes?: string
  repeat?: Task['repeat']
  repeatDays?: number[]
  repeatMonthDay?: number
  /** 每个周期要打卡的次数（默认 1） */
  repeatCount?: number
  /** 打卡时间点（可多个） */
  repeatTimes?: string[]
  estimateMinutes?: number
  status?: Task['status']
  startAt?: number
  folderId?: string
  docRef?: Task['docRef']
  aiRef?: string
  sortOrder?: number
}

/**
 * 新建任务。
 *
 * v3.1 时间语义（用户需求）：**检测不到开始时间就从现在开始，检测不到截止时间就是无穷远**。
 * 所以 startAt 缺省取 Date.now()，due 缺省保持 undefined（= ∞，不参与逾期判断）。
 * 这样新建的任务立刻可做、不会被「未来任务」锁住，也不会因为没写日期被算成逾期。
 */
export async function addTask(input: NewTaskInput): Promise<Task> {
  const now = Date.now()
  const task: Task = {
    id: uid(),
    title: input.title,
    tier: input.tier,
    priority: input.priority ?? 2,
    status: input.status ?? 'todo',
    tags: input.tags ?? [],
    notes: input.notes,
    due: input.due,
    dueTime: input.dueTime,
    repeat: input.repeat,
    repeatDays: input.repeatDays,
    repeatMonthDay: input.repeatMonthDay,
    repeatCount: input.repeatCount,
    repeatTimes: input.repeatTimes,
    estimateMinutes: input.estimateMinutes,
    startAt: input.startAt ?? now,
    folderId: input.folderId,
    docRef: input.docRef,
    aiRef: input.aiRef,
    sortOrder: input.sortOrder,
    createdAt: now,
    updatedAt: now,
  }
  await db.tasks.add(task)
  void syncTaskNotification(task)
  return task
}

/** 影响提醒调度的字段：变化时才重排通知，避免编辑标题时反复取消/注册 */
const REMINDER_KEYS = ['due', 'dueTime', 'repeatTimes', 'status'] as const

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: Date.now() })
  if (REMINDER_KEYS.some((k) => k in patch)) {
    const t = await db.tasks.get(id)
    if (t) void syncTaskNotification(t)
  }
}

/** 勾选完成 / 恢复。完成时事务内写 doneAt + 生成下一次（返回该新任务供撤销）；恢复时事务内回收已生成的下一次 */
export async function toggleDone(task: Task): Promise<Task | null> {
  if (task.status === 'done') {
    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.update(task.id, { status: 'todo', doneAt: undefined, updatedAt: Date.now() })
      if (!task.repeat) return
      const nextDue = nextDueForRepeat(task.due, task.repeat, todayStr(), { days: task.repeatDays, monthDay: task.repeatMonthDay })
      const spawned = await db.tasks
        .filter((t) => t.title === task.title && t.repeat === task.repeat && t.due === nextDue && t.status === 'todo' && t.createdAt > (task.doneAt ?? 0) && t.id !== task.id)
        .toArray()
      if (spawned.length) await db.tasks.bulkDelete(spawned.map((t) => t.id))
    })
    void syncTaskNotification({ ...task, status: 'todo' })
    return null
  }
  // 事务回调内的赋值需要非收窄载体
  const spawnedRef: { next: Task | null } = { next: null }
  await db.transaction('rw', db.tasks, async () => {
    const now = Date.now()
    await db.tasks.update(task.id, { status: 'done', doneAt: now, updatedAt: now })
    if (!task.repeat) return
    const nextDue = nextDueForRepeat(task.due, task.repeat, todayStr(), { days: task.repeatDays, monthDay: task.repeatMonthDay })
    const nextStart = nextCycleStart(nextDue, task.repeatTimes?.[0] ?? task.dueTime)
    const next: Task = {
      id: uid(),
      title: task.title,
      tier: nextDue > todayStr() ? 'upcoming' : task.tier,
      priority: task.priority,
      status: 'todo',
      due: nextDue,
      dueTime: task.dueTime,
      tags: task.tags,
      notes: task.notes,
      repeat: task.repeat,
      repeatDays: task.repeatDays,
      repeatMonthDay: task.repeatMonthDay,
      // 打卡次数与时间点跟着下一周期走，进度从 0 重新开始
      repeatCount: task.repeatCount,
      repeatTimes: task.repeatTimes,
      estimateMinutes: task.estimateMinutes,
      checkin: undefined,
      startAt: nextStart,
      docRef: task.docRef,
      aiRef: task.aiRef,
      sortOrder: task.sortOrder,
      createdAt: now,
      updatedAt: now,
    }
    spawnedRef.next = next
    await db.tasks.add(next)
  })
  void syncTaskNotification({ ...task, status: 'done' })
  const spawned = spawnedRef.next
  if (spawned) void syncTaskNotification(spawned)
  return spawned
}

/* ---------------- 打卡（v3.1：自定义时间与次数） ---------------- */

export interface CheckInResult {
  /** 是否已打满次数（任务归档，重复任务还会生成下一次） */
  completed: boolean
  /** 本周期已打卡次数 */
  count: number
  /** 本周期目标次数 */
  total: number
  spawned: Task | null
}

/** 周期间的清零键：有截止日用截止日，没有（∞）就按天算 */
function checkinCycleKey(task: Task): string {
  return task.due ?? todayStr()
}

/** 打卡进度：次数以 repeatCount 为准（默认 1），跨周期自动归零 */
export function checkinProgress(task: Task): { count: number; total: number } {
  const total = Math.max(1, Math.round(task.repeatCount ?? 1))
  const fresh = task.checkin && task.checkin.due === checkinCycleKey(task) ? task.checkin.count : 0
  return { count: Math.max(0, Math.min(fresh, total)), total }
}

/**
 * 打卡一次：没打满就只 +1，打满才走「完成」流程（归档 + 生成下一次）。
 * 返回结果让 UI 能显示「已打卡 2/3」而不是一句笼统的已完成。
 */
export async function checkInTask(task: Task): Promise<CheckInResult> {
  const { count, total } = checkinProgress(task)
  const at = Date.now()
  if (total <= 1 || count + 1 >= total) {
    const spawned = await toggleDone({ ...task, checkin: { due: checkinCycleKey(task), count: total, at } })
    return { completed: true, count: total, total, spawned }
  }
  await db.tasks.update(task.id, {
    checkin: { due: checkinCycleKey(task), count: count + 1, at },
    updatedAt: at,
  })
  return { completed: false, count: count + 1, total, spawned: null }
}

/** 下一次任务的开始时刻：截止日当天 0 点，有打卡时间就取第一个时间点 */
function nextCycleStart(due: string, time?: string): number {
  const base = parseDateStr(due).getTime()
  if (!time) return base
  const [h, m] = time.split(':').map(Number)
  return base + (h || 0) * 3600000 + (m || 0) * 60000
}

/** 撤销「勾选完成」：回到原状态（含 doing），并删除完成时生成的下一次任务 */
export async function undoToggleDone(task: Task, spawned: Task | null): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.update(task.id, { status: task.status, doneAt: undefined, updatedAt: Date.now() })
    if (spawned) await db.tasks.delete(spawned.id)
  })
  void syncTaskNotification(task)
  if (spawned) void syncTaskNotification({ ...spawned, status: 'done' })
}

export async function moveTier(id: string, tier: Tier): Promise<void> {
  await updateTask(id, { tier })
}

/** 删除：返回快照供撤销；同时取消提醒，并立墓碑供同步判重 */
export async function deleteTask(task: Task): Promise<Task> {
  await db.transaction('rw', [db.tasks, db.tombstones], async () => {
    await db.tasks.delete(task.id)
    await markDeleted(task.id)
  })
  void syncTaskNotification({ ...task, status: 'done' })
  return task
}

/** 顺延一天：截止日与开始时间一起往后推；没有截止的任务设成明天 */
export async function postponeTask(task: Task, days = 1): Promise<void> {
  const due = task.due ? addDaysStr(days, parseDateStr(task.due)) : addDaysStr(days)
  await updateTask(task.id, {
    due,
    tier: due > todayStr() ? 'upcoming' : task.tier,
    ...(task.startAt ? { startAt: task.startAt + days * 86400000 } : {}),
  })
}

/** 每日回顾：把今天没做完的整体挪到明天（截止日改明天、清单进「近期」） */
export async function rolloverTasks(tasks: Task[], toDate: string = addDaysStr(1)): Promise<void> {
  if (!tasks.length) return
  const now = Date.now()
  await db.transaction('rw', db.tasks, async () => {
    for (const t of tasks) {
      await db.tasks.update(t.id, { due: toDate, tier: 'upcoming', updatedAt: now })
    }
  })
  for (const t of tasks) {
    const updated = await db.tasks.get(t.id)
    if (updated) void syncTaskNotification(updated)
  }
}

export async function restoreTask(task: Task): Promise<void> {
  // 撤销删除时连同墓碑一起摘掉，否则下次同步会把刚恢复的任务再删一次
  await db.transaction('rw', [db.tasks, db.tombstones], async () => {
    await db.tasks.put(task)
    await db.tombstones.delete(task.id)
  })
}

/** 排序：置顶沉顶 → 优先级 P0→P3 → 截止日期 → 创建时间 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    // 打卡任务的自定义次序：只在两边都填了次序时生效，不影响普通任务的优先级排序
    if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder
    }
    if (a.priority !== b.priority) return a.priority - b.priority
    const ad = a.due ?? '9999-12-31'
    const bd = b.due ?? '9999-12-31'
    if (ad !== bd) return ad < bd ? -1 : 1
    if ((a.dueTime ?? '') !== (b.dueTime ?? '')) return (a.dueTime ?? '') < (b.dueTime ?? '') ? -1 : 1
    return b.createdAt - a.createdAt
  })
}

type BlobOut = { hash: string; type: string; blob: Blob }

interface ExportPayload {
  app: 'personal-workstation'
  version: 4
  exportedAt: string
  tasks: Task[]
  settings: SettingKV[]
  docs: Doc[]
  positions: ReadingPosition[]
  annotations: Annotation[]
  bookmarks: Bookmark[]
  aiSessions: AiSession[]
  aiMessages: AiMessage[]
  aiUsage: AiUsageRow[]
  docText: DocText[]
  focusSessions: FocusSession[]
  tombstones: Tombstone[]
  folders: Folder[]
  /** 手动导出的 JSON：文档本体内联 base64 */
  blobRows?: { hash: string; type: string; data: string }[]
  /** 目录式快照：文档本体在 blobs/<hash>，这里只留清单 */
  blobMeta?: { hash: string; type: string }[]
}

const SNAPSHOT_HEAD = { app: 'personal-workstation' as const, version: 4 as const }

/** 只属于本机的设置：WebDAV 口令、同步/备份时间戳、通知权限状态 */
const LOCAL_ONLY_SETTINGS = new Set(['webdav', 'lastSyncAt', 'lastAutoBackupAt', 'notifyEnabled'])

/**
 * 一次读出所有表（手动导出与自动快照共用）。
 *
 * 有意不含 aiProviders：那张表存的是明文 apiKey，AI 面板下线后已无用途，
 * 导出 / 自动快照 / WebDAV 同步（同样走这个函数）都不该把它带出去。
 */
type TableData = Pick<ExportPayload, 'tasks' | 'settings' | 'docs' | 'positions' | 'annotations' | 'bookmarks' | 'aiSessions' | 'aiMessages' | 'aiUsage' | 'docText' | 'focusSessions' | 'tombstones' | 'folders'>

async function collectAll(): Promise<{ data: TableData; blobs: BlobOut[] }> {
  const [tasks, settings, docs, blobs, positions, annotations, bookmarks, aiSessions, aiMessages, aiUsage, docText, focusSessions] = await Promise.all([
    db.tasks.toArray(),
    db.settings.toArray(),
    db.docs.toArray(),
    db.blobs.toArray(),
    db.positions.toArray(),
    db.annotations.toArray(),
    db.bookmarks.toArray(),
    db.aiSessions.toArray(),
    db.aiMessages.toArray(),
    db.aiUsage.toArray(),
    db.docText.toArray(),
    db.focusSessions.toArray(),
  ])
  const tombstones = await db.tombstones.toArray()
  const folders = await db.folders.toArray()
  return {
    // 设备本地的口令 / 时间戳不进导出，避免同步或备份时把 WebDAV 口令带出去
    data: {
      tasks,
      settings: settings.filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key)),
      docs,
      positions,
      annotations,
      bookmarks,
      aiSessions,
      aiMessages,
      aiUsage,
      docText,
      focusSessions,
      tombstones,
      folders,
    },
    blobs: blobs.map((r) => ({ hash: r.hash, type: r.blob.type, blob: r.blob })),
  }
}

/** 手动导出：单个 JSON（文档内联 base64），能拷到别的设备导入 */
export async function exportAll(): Promise<string> {
  const { data, blobs } = await collectAll()
  const blobRows = await Promise.all(
    blobs.map(async (r) => ({ hash: r.hash, type: r.type, data: await blobToBase64(r.blob) })),
  )
  return JSON.stringify({ ...SNAPSHOT_HEAD, exportedAt: new Date().toISOString(), ...data, blobRows }, null, 2)
}

/**
 * 自动快照：JSON 只写清单，文档本体由调用方逐个写进 OPFS。
 * 旧实现把整个文档库 base64 塞进一个字符串（体积 +33%，且要在内存里拼出巨型 string），
 * 文档一多，开 App 时那次静默备份就会卡顿甚至被系统杀掉。
 */
export async function exportSnapshotParts(): Promise<{ json: string; blobs: BlobOut[] }> {
  const { data, blobs } = await collectAll()
  return {
    json: JSON.stringify({ ...SNAPSHOT_HEAD, exportedAt: new Date().toISOString(), ...data, blobMeta: blobs.map(({ hash, type }) => ({ hash, type })) }, null, 2),
    blobs,
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export interface ImportResult {
  tasks: number
  settings: number
  docs?: number
  /** 结构校验通过但有疑点（孤儿批注、缺本体等），由 UI 提示 */
  warnings: string[]
}

/** merge = 手动导入（同 id 覆盖，不动别的）；replace = 恢复快照（快照没覆盖的表保持原样） */
export type ImportMode = 'merge' | 'replace'

const IMPORT_TABLES: [string, Table<any, any>][] = [
  ['tasks', db.tasks],
  ['settings', db.settings],
  ['docs', db.docs],
  ['blobs', db.blobs],
  ['positions', db.positions],
  ['annotations', db.annotations],
  ['bookmarks', db.bookmarks],
  ['aiSessions', db.aiSessions],
  ['aiMessages', db.aiMessages],
  ['aiUsage', db.aiUsage],
  ['docText', db.docText],
  ['focusSessions', db.focusSessions],
  ['tombstones', db.tombstones],
  ['folders', db.folders],
]

/**
 * 写入前的统一入口：
 * 1) 结构校验（应用标识 / 版本 / 字段类型 / 枚举）——不通过就一条数据都不写
 * 2) replace 模式只替换「备份负责的数据」，本机专属设置（WebDAV 口令、同步时间戳）保留
 */
async function writeAll(raw: unknown, mode: ImportMode): Promise<ImportResult> {
  const { data, warnings } = validateSnapshot(raw)
  const result: ImportResult = { tasks: 0, settings: 0, docs: 0, warnings }
  const has = (k: string) => Array.isArray(data[k])
  await db.transaction(
    'rw',
    IMPORT_TABLES.map(([, t]) => t),
    async () => {
      if (mode === 'replace') {
        // 真恢复：先清空快照覆盖到的表——快照之后新建的记录会消失，快照之后删掉的会回来。
        // 老备份缺哪张表就不动哪张，避免顺手把现有数据清空。
        for (const [key, t] of IMPORT_TABLES) {
          if (key === 'blobs') {
            if (has('blobRows')) await t.clear()
            continue
          }
          if (key === 'settings') {
            if (has('settings')) {
              // 只清「备份负责的设置」。整表 clear 会把 webdav（含口令）、lastSyncAt、
              // lastAutoBackupAt、notifyEnabled 一起清掉 —— 恢复一次备份就得重新填 WebDAV。
              await db.settings.filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key)).delete()
            }
            continue
          }
          if (has(key)) await t.clear()
        }
      }
      if (has('tasks')) {
        await db.tasks.bulkPut(data.tasks as Task[])
        result.tasks = (data.tasks as Task[]).length
      }
      if (has('settings')) {
        // 备份本不该带本机专属项（导出时已排除），手改过的文件这里再挡一道，别让它覆盖本机口令
        const rows = (data.settings as SettingKV[]).filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key))
        await db.settings.bulkPut(rows)
        result.settings = rows.length
      }
      if (has('docs')) {
        await db.docs.bulkPut(data.docs as Doc[])
        result.docs = (data.docs as Doc[]).length
      }
      if (has('blobRows')) {
        const rows = (data.blobRows as { hash: string; type?: string; data?: string; blob?: Blob }[]).map((r) => ({
          hash: r.hash,
          blob: r.blob instanceof Blob ? r.blob : base64ToBlob(r.data ?? '', r.type ?? 'application/octet-stream'),
        }))
        await db.blobs.bulkPut(rows)
      }
      if (has('positions')) await db.positions.bulkPut(data.positions as ReadingPosition[])
      if (has('annotations')) await db.annotations.bulkPut(data.annotations as Annotation[])
      if (has('bookmarks')) await db.bookmarks.bulkPut(data.bookmarks as Bookmark[])
      // 老备份里的 aiProviders 不还原：那是明文 apiKey，回来就等于把密钥又摊在磁盘上
      if (has('aiSessions')) await db.aiSessions.bulkPut(data.aiSessions as AiSession[])
      if (has('aiMessages')) await db.aiMessages.bulkPut(data.aiMessages as AiMessage[])
      if (has('aiUsage')) await db.aiUsage.bulkPut(data.aiUsage as AiUsageRow[])
      if (has('docText')) await db.docText.bulkPut(data.docText as DocText[])
      if (has('focusSessions')) await db.focusSessions.bulkPut(data.focusSessions as FocusSession[])
      if (has('tombstones')) await db.tombstones.bulkPut(data.tombstones as Tombstone[])
      if (has('folders')) await db.folders.bulkPut(data.folders as Folder[])
    },
  )
  return result
}

export async function importAll(json: string, mode: ImportMode = 'merge'): Promise<ImportResult> {
  return writeAll(parseJson(json), mode)
}

/** JSON 解析失败时给一句人话（文件截断、选错文件都落到这里） */
function parseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown
  } catch {
    throw new Error('文件不是合法 JSON：可能已损坏或被截断')
  }
}

/** 目录式快照的写入路径：json 里的清单 + 从 OPFS 读出来的原始 Blob */
export async function importSnapshotParts(
  parts: { json: string; blobs: { hash: string; type?: string; blob: Blob }[] },
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const data = parseJson(parts.json) as Record<string, unknown>
  data.blobRows = parts.blobs
  return writeAll(data, mode)
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.settings, db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.aiProviders, db.aiSessions, db.aiMessages, db.aiUsage, db.docText, db.focusSessions, db.tombstones, db.folders],
    async () => {
      await db.tasks.clear()
      await db.settings.clear()
      await db.docs.clear()
      await db.blobs.clear()
      await db.positions.clear()
      await db.annotations.clear()
      await db.bookmarks.clear()
      await db.aiProviders.clear()
      await db.aiSessions.clear()
      await db.aiMessages.clear()
      await db.aiUsage.clear()
      await db.docText.clear()
      await db.focusSessions.clear()
      await db.tombstones.clear()
      await db.folders.clear()
      localStorage.removeItem('ws-doc-tabs')
      localStorage.removeItem('ws-focus-records')
    },
  )
  // 清空也是一次「删除」：写一个纪元时间戳，另一台设备同步时不会把旧数据合并回来
  await db.settings.put({ key: 'syncEpoch', value: Date.now() })
}
