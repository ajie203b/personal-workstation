import type { Tombstone } from '@/db/db'
import { uid } from '@/lib/id'
import type { PackedMathNote } from '@/modules/tools/mathnotes/backupCodec'

/**
 * 手写计算笔记的独立同步文件 mathnotes-sync.json（与 sync.json 同目录）的合并逻辑（纯函数，便于单测）。
 *
 * 为什么不放进 sync.json：已发布的 v3.6.6 及更早版本不认识 mathNotes 字段，
 * 它们同步时按自己认识的字段重写整份 sync.json，新版写进去的笔记会被悄悄抹掉。
 * 独立文件旧客户端根本不碰，新客户端在主同步之后顺带读写它，失败也不影响主同步。
 *
 * 为什么是一个文件而不是每页一个文件：
 * - 笔迹已紧凑编码，一页常见几十 KB，几十页也就 1~2 MB，单文件一次 GET/PUT 足够；
 * - 每页一个文件需要 PROPFIND 列目录、N 次请求，坚果云对请求频率有限制，安卓上也慢；
 * - 冲突粒度仍是「页」：用本机上次同步成功的版本判断双方是否修改，配合 ETag 防并发覆盖；
 *   两台设备改不同的页互不影响；同一页两边都改时保留冲突副本。
 * 以后页数多到单文件明显变慢，再按 id 前缀分片即可，格式里留了 version。
 *
 * 规则（只管笔记，自带墓碑与清空纪元）：
 * - 同一页从共同版本分别编辑时，保留远端原页和本地冲突副本；单端修改直接采用新版本
 * - 墓碑优先：任何一端有墓碑的 id 从结果里去掉
 * - 纪元：本机「清空数据」时记下的笔记纪元。双方都有纪元且不同时，更大的一侧整份胜出；
 *   本机从没同步过笔记（纪元为空）时正常合并，不会把首次同步前写的笔记清掉
 */

export const MATH_NOTES_SYNC_FILE = 'mathnotes-sync.json'
export const MATH_NOTES_SYNC_KIND = 'kairos-math-notes'
export const MATH_NOTES_SYNC_VERSION = 1

export interface MathNotesSyncFile {
  app: string
  kind: typeof MATH_NOTES_SYNC_KIND
  version: number
  exportedAt: string
  /** 笔记的清空纪元；没人清空过时为 0 */
  epoch: number
  notes: PackedMathNote[]
  /** 只含笔记页的墓碑 */
  tombstones: Tombstone[]
}

export interface MathNotesLocalState {
  notes: PackedMathNote[]
  /** 本机全部墓碑（id 是全局唯一的 uid，混着其它表的也无妨） */
  tombstones: Tombstone[]
  /** 本机记录的笔记纪元；undefined = 从没同步过笔记、也没清空过 */
  epoch: number | undefined
}

export interface MathNotesMergeResult {
  /** 合并后的笔记（要落库、要推上去的内容） */
  notes: PackedMathNote[]
  /** 要写进同步文件的墓碑 */
  tombstones: Tombstone[]
  epoch: number
  /** 远端纪元更大：本机笔记要先清空再整份写入 */
  replaceLocal: boolean
}

function mergeTombstones(...lists: Tombstone[][]): Tombstone[] {
  const map = new Map<string, Tombstone>()
  for (const list of lists) {
    for (const t of list) {
      const cur = map.get(t.id)
      if (!cur || t.ts > cur.ts) map.set(t.id, t)
    }
  }
  return [...map.values()]
}

/**
 * 同步文件里只放「和笔记有关」的墓碑：远端文件里出现过的笔记 id / 远端已有的墓碑，
 * 以及本机这一轮合并前还认识的笔记 id。这样本机删掉一页、远端还有它时，墓碑一定会写上去。
 */
export function noteTombstones(all: Tombstone[], relevantIds: Iterable<string>): Tombstone[] {
  const ids = new Set(relevantIds)
  return all.filter((t) => ids.has(t.id))
}

/** 忽略保存时间，仅比较实际内容，避免同内容重复生成冲突副本。 */
function sameContent(a: PackedMathNote, b: PackedMathNote): boolean {
  const { updatedAt: _a, ...contentA } = a
  const { updatedAt: _b, ...contentB } = b
  return JSON.stringify(contentA) === JSON.stringify(contentB)
}

export function mergeMathNotes(local: MathNotesLocalState, remote: MathNotesSyncFile | null, baseline: Record<string, PackedMathNote> = {}): MathNotesMergeResult {
  const localEpoch = local.epoch
  if (!remote) {
    return {
      notes: local.notes.filter((n) => !local.tombstones.some((t) => t.id === n.id)),
      tombstones: [],
      epoch: localEpoch ?? 0,
      replaceLocal: false,
    }
  }
  const remoteEpoch = remote.epoch || 0
  const remoteIds = [...remote.notes.map((n) => n.id), ...remote.tombstones.map((t) => t.id)]
  const relevant = new Set([...remoteIds, ...local.notes.map((n) => n.id)])

  if (localEpoch !== undefined && localEpoch > remoteEpoch) {
    // 本机清空过、远端还是清空前的数据：本机整份胜出
    return {
      notes: local.notes,
      tombstones: noteTombstones(local.tombstones, relevant),
      epoch: localEpoch,
      replaceLocal: false,
    }
  }
  if (localEpoch !== undefined && remoteEpoch > localEpoch) {
    // 另一台设备清空过：远端整份胜出，本机笔记先清空
    return { notes: remote.notes, tombstones: remote.tombstones, epoch: remoteEpoch, replaceLocal: true }
  }

  const tombstones = mergeTombstones(remote.tombstones, noteTombstones(local.tombstones, relevant))
  const dead = new Set([...tombstones.map((t) => t.id), ...local.tombstones.map((t) => t.id)])
  const map = new Map<string, PackedMathNote>()
  for (const n of local.notes) if (!dead.has(n.id)) map.set(n.id, n)
  for (const n of remote.notes) {
    if (dead.has(n.id)) continue
    const cur = map.get(n.id)
    if (!cur) { map.set(n.id, n); continue }
    const base = baseline[n.id]
    if (sameContent(cur, n)) {
      if (n.updatedAt > cur.updatedAt) map.set(n.id, n)
    } else if (base && sameContent(n, base)) {
      // 远端未改，本地更新。
    } else if (base && sameContent(cur, base)) {
      map.set(n.id, n)
    } else {
      // 两边均有修改（或没有共同基线），不能依赖时钟丢弃任何一边。
      const title = cur.title.endsWith('（冲突副本）') ? cur.title : `${cur.title}（冲突副本）`
      const copy = { ...cur, id: uid(), title, createdAt: cur.createdAt + 1 }
      map.set(n.id, n)
      map.set(copy.id, copy)
    }
  }
  return {
    notes: [...map.values()],
    tombstones,
    epoch: Math.max(remoteEpoch, localEpoch ?? 0),
    replaceLocal: false,
  }
}

export function buildMathNotesFile(app: string, notes: PackedMathNote[], tombstones: Tombstone[], epoch: number, now = Date.now()): MathNotesSyncFile {
  return {
    app,
    kind: MATH_NOTES_SYNC_KIND,
    version: MATH_NOTES_SYNC_VERSION,
    exportedAt: new Date(now).toISOString(),
    epoch,
    notes,
    tombstones,
  }
}

/** 解析远端文件；格式不对就抛错（不覆盖一份看不懂的文件） */
export function parseMathNotesFile(text: string): MathNotesSyncFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`远端 ${MATH_NOTES_SYNC_FILE} 不是合法 JSON`)
  }
  const r = raw as Partial<MathNotesSyncFile> | null
  if (!r || typeof r !== 'object' || r.kind !== MATH_NOTES_SYNC_KIND || !Array.isArray(r.notes)) {
    throw new Error(`远端 ${MATH_NOTES_SYNC_FILE} 格式不对`)
  }
  if (typeof r.version === 'number' && r.version > MATH_NOTES_SYNC_VERSION) {
    throw new Error(`远端 ${MATH_NOTES_SYNC_FILE} 来自更新版本的应用，请先升级本机应用`)
  }
  return {
    app: r.app ?? '',
    kind: MATH_NOTES_SYNC_KIND,
    version: r.version ?? MATH_NOTES_SYNC_VERSION,
    exportedAt: r.exportedAt ?? '',
    epoch: typeof r.epoch === 'number' ? r.epoch : 0,
    notes: r.notes,
    tombstones: Array.isArray(r.tombstones) ? r.tombstones : [],
  }
}
