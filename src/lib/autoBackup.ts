import { db } from '@/db/db'
import { exportAll, importAll } from '@/db/tasks'

/**
 * 自动备份（v1.3）：本地 OPFS（Origin Private File System）滚动快照。
 * 无服务器、无云同步 —— 打开应用时若距上次快照超过 24h，静默写一份；
 * 永远保留最近 3 份，可在设置页一键恢复。
 */

const ENABLE_KEY = 'autoBackupEnabled'
const LAST_AT_KEY = 'lastAutoBackupAt'
const DIR_NAME = 'backups'
const KEEP = 3
const INTERVAL_MS = 24 * 60 * 60 * 1000

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
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 写一份快照并滚动清理旧文件 */
export async function writeSnapshot(): Promise<string> {
  const json = await exportAll()
  const dir = await backupsDir()
  const name = `snapshot-${stamp()}.json`
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(json)
  await w.close()
  await db.settings.put({ key: LAST_AT_KEY, value: Date.now() })
  // 滚动保留最近 KEEP 份
  const names = (await listBackups()).map((b) => b.name)
  for (const old of names.slice(KEEP)) {
    try { await dir.removeEntry(old) } catch { /* ignore */ }
  }
  return name
}

export interface BackupInfo {
  name: string
  size: number
  at: number
}

export async function listBackups(): Promise<BackupInfo[]> {
  if (!opfsAvailable()) return []
  const dir = await backupsDir()
  const out: BackupInfo[] = []
  // @ts-expect-error: async iterator 在部分 TS lib 版本缺失
  for await (const [name, handle] of dir.entries()) {
    if (!name.startsWith('snapshot-') || !name.endsWith('.json')) continue
    if (handle.kind !== 'file') continue
    const f = await (handle as FileSystemFileHandle).getFile()
    out.push({ name, size: f.size, at: f.lastModified })
  }
  return out.sort((a, b) => b.at - a.at)
}

export async function readBackup(name: string): Promise<string> {
  const dir = await backupsDir()
  const fh = await dir.getFileHandle(name)
  const f = await fh.getFile()
  return f.text()
}

export async function restoreBackup(name: string): Promise<void> {
  const json = await readBackup(name)
  await importAll(json)
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
