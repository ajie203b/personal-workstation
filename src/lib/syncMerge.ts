import type { Annotation, Bookmark, Doc, FocusSession, Folder, ReadingPosition, SettingKV, Task, Tombstone } from '@/db/db'

/**
 * WebDAV 同步的合并逻辑（纯函数，便于单测）。
 * 规则：
 * - 同一 id 取更新时间更晚的一份；更新时间字段见各表
 * - 墓碑优先：任何 id 有墓碑就从结果里去掉（删除不会被另一台设备推回来）
 * - 设置项本地优先，远端独有的键补进来
 * - 纪元（清空数据）更大的一侧整份胜出，另一侧需要先清空再写入
 * - 文档本体 (blobMeta) 取并集，内容按 hash 寻址，谁有都不丢
 */

export interface SyncPayload {
  app: string
  version: number
  exportedAt: string
  tasks: Task[]
  settings: SettingKV[]
  docs: Doc[]
  positions: ReadingPosition[]
  annotations: Annotation[]
  bookmarks: Bookmark[]
  focusSessions: FocusSession[]
  folders: Folder[]
  tombstones: Tombstone[]
  blobMeta: { hash: string; type: string }[]
  /** 清空数据的纪元：更晚的一侧代表「我刚清空过」，整份数据算数 */
  epoch?: number
}

export interface MergeResult {
  payload: SyncPayload
  /** 需要先清空本地同步表再整份写入（清空纪元胜出） */
  replaceAll: boolean
}

const taskTs = (t: Task) => t.updatedAt ?? t.createdAt
const docTs = (d: Doc) => d.updatedAt ?? d.addedAt
const annTs = (a: Annotation) => a.updatedAt ?? a.createdAt
const markTs = (b: Bookmark) => b.updatedAt ?? b.createdAt

function mergeByKey<T>(
  local: T[],
  remote: T[],
  key: (x: T) => string,
  ts: (x: T) => number,
  dead: Set<string>,
): T[] {
  const map = new Map<string, T>()
  for (const x of local) {
    const k = key(x)
    if (!dead.has(k)) map.set(k, x)
  }
  for (const x of remote) {
    const k = key(x)
    if (dead.has(k)) {
      map.delete(k)
      continue
    }
    const cur = map.get(k)
    if (!cur || ts(x) > ts(cur)) map.set(k, x)
  }
  return [...map.values()]
}

function mergeTombstones(local: Tombstone[], remote: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>()
  for (const t of [...local, ...remote]) {
    const cur = map.get(t.id)
    if (!cur || t.ts > cur.ts) map.set(t.id, t)
  }
  return [...map.values()]
}

function mergeBlobMeta(
  local: { hash: string; type: string }[],
  remote: { hash: string; type: string }[],
): { hash: string; type: string }[] {
  const map = new Map<string, { hash: string; type: string }>()
  for (const m of remote) map.set(m.hash, m)
  for (const m of local) if (!map.has(m.hash) || !map.get(m.hash)!.type) map.set(m.hash, m)
  return [...map.values()]
}

/** 设置项：本地已有的一律保留，远端独有的补上 */
function mergeSettings(local: SettingKV[], remote: SettingKV[]): SettingKV[] {
  const map = new Map<string, SettingKV>()
  for (const s of remote) map.set(s.key, s)
  for (const s of local) map.set(s.key, s)
  return [...map.values()]
}

export function mergePayloads(local: SyncPayload, remote: SyncPayload | null, now = Date.now()): MergeResult {
  if (!remote) {
    return {
      payload: { ...local, exportedAt: new Date(now).toISOString() },
      replaceAll: false,
    }
  }

  const localEpoch = local.epoch ?? 0
  const remoteEpoch = remote.epoch ?? 0
  const epoch = Math.max(localEpoch, remoteEpoch)
  const blobMeta = mergeBlobMeta(local.blobMeta ?? [], remote.blobMeta ?? [])

  if (localEpoch > remoteEpoch) {
    return {
      payload: { ...local, epoch, blobMeta, exportedAt: new Date(now).toISOString() },
      replaceAll: true,
    }
  }
  if (remoteEpoch > localEpoch) {
    return {
      payload: { ...remote, epoch, blobMeta, exportedAt: new Date(now).toISOString() },
      replaceAll: true,
    }
  }

  const tombstones = mergeTombstones(local.tombstones ?? [], remote.tombstones ?? [])
  const dead = new Set(tombstones.map((t) => t.id))

  return {
    payload: {
      app: local.app || remote.app,
      version: Math.max(local.version || 0, remote.version || 0),
      exportedAt: new Date(now).toISOString(),
      epoch,
      tasks: mergeByKey(local.tasks ?? [], remote.tasks ?? [], (t) => t.id, taskTs, dead),
      settings: mergeSettings(local.settings ?? [], remote.settings ?? []),
      docs: mergeByKey(local.docs ?? [], remote.docs ?? [], (d) => d.id, docTs, dead),
      positions: mergeByKey(local.positions ?? [], remote.positions ?? [], (p) => p.hash, (p) => p.updatedAt, dead),
      annotations: mergeByKey(local.annotations ?? [], remote.annotations ?? [], (a) => a.id, annTs, dead),
      bookmarks: mergeByKey(local.bookmarks ?? [], remote.bookmarks ?? [], (b) => b.id, markTs, dead),
      focusSessions: mergeByKey(local.focusSessions ?? [], remote.focusSessions ?? [], (f) => f.id, (f) => f.ts, dead),
      folders: mergeByKey(local.folders ?? [], remote.folders ?? [], (f) => f.id, (f) => f.updatedAt, dead),
      tombstones,
      blobMeta,
    },
    replaceAll: false,
  }
}
