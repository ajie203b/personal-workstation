import { db } from '@/db/db'
import { exportSnapshotParts, importAll, importSnapshotParts } from '@/db/tasks'

/**
 * 自动备份（v1.3）：本地 OPFS（Origin Private File System）滚动快照。
 * 无服务器、无云同步 —— 打开应用时若距上次快照超过 24h，静默写一份；
 * 永远保留最近 3 份，可在设置页一键恢复。
 *
 * v1.5.10 起快照改成目录式：`snapshot-<stamp>/data.json` + `blobs/<hash>`。
 * 旧格式（单个 .json，文档 base64 内联）仍可列出与恢复，但不再新写 ——
 * 把整个文档库 base64 塞进一个字符串会让体积 +33%，且要在内存里拼出巨型 string，
 * 文档一多，启动时那次静默备份就会卡顿甚至被系统回收。
 */

const ENABLE_KEY = 'autoBackupEnabled'
const LAST_AT_KEY = 'lastAutoBackupAt'
const DIR_NAME = 'backups'
const KEEP = 3
const INTERVAL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'snapshot-'

function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage
}

export async function getAutoBackupEnabled(): Promise<boolean> {
  const row = await db.settings.get(ENABLE_KEY)
  return row ? row.value !== false : true // 默认开
}

export async function setAutoBackupEnabled(on: boolean): Promise<void> {
  await db.settings.put({ key: ENABLE_KEY, value: on })
}

async function backupsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIR_NAME, { create: true })
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  // 精确到秒：同一分钟内连点两次「生成快照」不会复用同一目录互相覆盖
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** OPFS 的 entries() 在部分 TS lib 版本里没有异步迭代器声明 */
async function entriesOf(dir: FileSystemDirectoryHandle): Promise<[string, FileSystemHandle][]> {
  const out: [string, FileSystemHandle][] = []
  // @ts-expect-error: async iterator 在部分 TS lib 版本缺失
  for await (const [name, handle] of dir.entries()) out.push([name, handle])
  return out
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<number> {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
  return typeof data === 'string' ? new Blob([data]).size : data.size
}

/** 写一份目录式快照并滚动清理旧文件 */
export async function writeSnapshot(): Promise<string> {
  const parts = await exportSnapshotParts()
  const dir = await backupsDir()
  const name = `${PREFIX}${stamp()}`
  const snap = await dir.getDirectoryHandle(name, { create: true })

  let bytes = await writeFile(snap, 'data.json', parts.json)
  if (parts.blobs.length) {
    const bd = await snap.getDirectoryHandle('blobs', { create: true })
    for (const b of parts.blobs) {
      bytes += await writeFile(bd, b.hash, b.blob)
    }
  }
  // meta 让设置页不必为了显示体积去逐个读文档本体
  await writeFile(snap, 'meta.json', JSON.stringify({ at: Date.now(), bytes, blobs: parts.blobs.length }))

  await db.settings.put({ key: LAST_AT_KEY, value: Date.now() })
  // 滚动保留最近 KEEP 份（目录与旧格式 .json 一起算）
  const names = (await listBackups()).map((b) => b.name)
  for (const old of names.slice(KEEP)) {
    try { await dir.removeEntry(old, { recursive: true }) } catch { /* ignore */ }
  }
  return name
}

export interface BackupInfo {
  name: string
  size: number
  at: number
}

/** 目录快照的完整体积：老快照没有 meta.json，或 meta 里没记 bytes 时逐文件相加 */
async function dirBytes(dir: FileSystemDirectoryHandle): Promise<number> {
  let total = 0
  for (const [, handle] of await entriesOf(dir)) {
    try {
      if (handle.kind === 'file') total += (await (handle as FileSystemFileHandle).getFile()).size
      else total += await dirBytes(handle as FileSystemDirectoryHandle)
    } catch { /* 读不到的文件跳过，别让一份坏快照拖垮整个列表 */ }
  }
  return total
}

export async function listBackups(): Promise<BackupInfo[]> {
  if (!opfsAvailable()) return []
  const dir = await backupsDir()
  const out: BackupInfo[] = []
  for (const [name, handle] of await entriesOf(dir)) {
    if (!name.startsWith(PREFIX)) continue
    if (handle.kind === 'file') {
      // 旧格式：snapshot-*.json，文档 base64 内联
      if (!name.endsWith('.json')) continue
      const f = await (handle as FileSystemFileHandle).getFile()
      out.push({ name, size: f.size, at: f.lastModified })
      continue
    }
    // 新格式：目录
    try {
      const snap = handle as FileSystemDirectoryHandle
      const metaFile = await (await snap.getFileHandle('meta.json')).getFile()
      const meta = JSON.parse(await metaFile.text()) as { at?: number; bytes?: number }
      // 老版本的 meta 里没有 bytes，别直接把 0 当成「空快照」显示
      const size = meta.bytes && meta.bytes > 0 ? meta.bytes : await dirBytes(snap)
      out.push({ name, size, at: meta.at ?? metaFile.lastModified })
    } catch {
      try {
        const snap = handle as FileSystemDirectoryHandle
        const metaFile = await (await snap.getFileHandle('data.json')).getFile()
        out.push({ name, size: await dirBytes(snap), at: metaFile.lastModified })
      } catch { /* 半截快照，忽略 */ }
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

async function readLegacy(name: string): Promise<string> {
  const dir = await backupsDir()
  const fh = await dir.getFileHandle(name)
  return (await fh.getFile()).text()
}

async function readDirSnapshot(name: string): Promise<{ json: string; blobs: { hash: string; type: string; blob: Blob }[] }> {
  const dir = await backupsDir()
  const snap = await dir.getDirectoryHandle(name)
  const json = await (await (await snap.getFileHandle('data.json')).getFile()).text()
  const meta = new Map<string, string>()
  try {
    const parsed = JSON.parse(json) as { blobMeta?: { hash: string; type: string }[] }
    for (const m of parsed.blobMeta ?? []) meta.set(m.hash, m.type)
  } catch { /* 清单坏了就退回文件自带的 type */ }

  const blobs: { hash: string; type: string; blob: Blob }[] = []
  try {
    const bd = await snap.getDirectoryHandle('blobs')
    for (const [hash, handle] of await entriesOf(bd)) {
      if (handle.kind !== 'file') continue
      const f = await (handle as FileSystemFileHandle).getFile()
      const type = meta.get(hash) ?? f.type ?? 'application/octet-stream'
      blobs.push({ hash, type, blob: type === f.type ? f : new Blob([f], { type }) })
    }
  } catch { /* 没有 blobs 目录：只有元数据的快照 */ }
  return { json, blobs }
}

/**
 * 恢复快照 = 真恢复（替换语义）：先清空快照覆盖的表再写入。
 * 旧实现走 importAll 的 bulkPut 合并 —— 快照之后新建的数据还在、快照之后删掉的又回来，结果是混合状态。
 */
export async function restoreBackup(name: string): Promise<void> {
  if (name.endsWith('.json')) {
    await importAll(await readLegacy(name), 'replace')
    return
  }
  await importSnapshotParts(await readDirSnapshot(name), 'replace')
}

/** 应用启动钩子：开启且超 24h → 静默快照（失败静默，不打扰） */
export async function maybeAutoBackup(): Promise<void> {
  try {
    if (!opfsAvailable()) return
    if (!(await getAutoBackupEnabled())) return
    const last = (await db.settings.get(LAST_AT_KEY))?.value as number | undefined
    if (last && Date.now() - last < INTERVAL_MS) return
    await writeSnapshot()
  } catch { /* 静默失败：存储满/隐私模式等，不影响使用 */ }
}

/* ---------------- 旧快照里的凭据清理（v2.0.1） ---------------- */

const SCRUB_KEY = 'snapshotsScrubbedOfAiKeys'

/** 去掉快照 JSON 里的 aiProviders（AI 服务商 + 明文 Key），其余原样保留 */
function stripAiProviders(text: string): string {
  try {
    const obj = JSON.parse(text) as Record<string, unknown> | null
    if (!obj || typeof obj !== 'object' || !('aiProviders' in obj)) return text
    delete obj.aiProviders
    return JSON.stringify(obj, null, 2)
  } catch {
    // 解析不了就别动，宁可留着也不能把备份写坏
    return text
  }
}

/**
 * 把磁盘上已有的几份快照就地「消毒」：只摘掉 aiProviders 这一个字段，
 * 任务、文档、批注等照原样保留（不做删除，只是不再让明文 Key 躺在备份里）。
 * 一次跑完打标记，之后启动不再扫。
 */
export async function scrubSnapshotSecrets(): Promise<void> {
  try {
    if (!opfsAvailable()) return
    if ((await db.settings.get(SCRUB_KEY))?.value === 1) return
    const dir = await backupsDir()
    for (const [name, handle] of await entriesOf(dir)) {
      if (!name.startsWith(PREFIX)) continue
      try {
        if (handle.kind === 'file') {
          if (!name.endsWith('.json')) continue
          const fh = await dir.getFileHandle(name)
          const text = await (await fh.getFile()).text()
          const cleaned = stripAiProviders(text)
          if (cleaned !== text) await writeFile(dir, name, cleaned)
        } else {
          const snap = handle as FileSystemDirectoryHandle
          const fh = await snap.getFileHandle('data.json')
          const text = await (await fh.getFile()).text()
          const cleaned = stripAiProviders(text)
          if (cleaned !== text) await writeFile(snap, 'data.json', cleaned)
        }
      } catch { /* 单份坏了跳过，不影响其它快照 */ }
    }
    await db.settings.put({ key: SCRUB_KEY, value: 1 })
  } catch { /* 静默：隐私模式 / 配额不足 */ }
}
