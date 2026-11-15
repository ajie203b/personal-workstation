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

async function findLegacySnapshots() {
  const backups = await getLegacyBackups()
  const names: string[] = []
  if (!backups) return { backups, names }
  const entries = backups as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }
  for await (const name of entries.keys()) {
    if (SNAPSHOT_NAME.test(name)) names.push(name)
  }
  return { backups, names }
}

export async function countLegacySnapshots(): Promise<number> {
  return (await findLegacySnapshots()).names.length
}

export async function clearLegacySnapshots(): Promise<number> {
  const { backups, names } = await findLegacySnapshots()
  for (const name of names) await backups?.removeEntry(name, { recursive: true })
  return names.length
}
