const SNAPSHOT_NAME = /^snapshot-\d{8}-(?:\d{6}(?:\.json)?|\d{4}\.json)$/

async function getLegacyBackups(): Promise<FileSystemDirectoryHandle | null> {
  if (!navigator.storage?.getDirectory) return null
  const root = await navigator.storage.getDirectory()
  try {
    return await root.getDirectoryHandle('backups')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

export async function clearLegacySnapshots(): Promise<number> {
  const backups = await getLegacyBackups()
  if (!backups) return 0
  // 收集文件名，删除过程中不改变正在遍历的目录。
  const names: string[] = []
  const entries = backups as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
  for await (const name of entries.keys()) {
    if (SNAPSHOT_NAME.test(name)) names.push(name)
  }
  for (const name of names) await backups.removeEntry(name, { recursive: true })
  return names.length
}
