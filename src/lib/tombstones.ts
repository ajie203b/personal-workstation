import { db } from '@/db/db'

/** 删除墓碑：同步时用它判断「这条是有意删掉的」，防止另一台设备把旧记录推回来 */
export async function markDeleted(...ids: string[]): Promise<void> {
  if (!ids.length) return
  const ts = Date.now()
  await db.tombstones.bulkPut(ids.map((id) => ({ id, ts })))
}

/** 清理过期墓碑（保留半年，足够覆盖不常同步的设备） */
export async function pruneTombstones(): Promise<void> {
  const cutoff = Date.now() - 180 * 86400000
  try {
    await db.tombstones.where('ts').below(cutoff).delete()
  } catch { /* 忽略 */ }
}
