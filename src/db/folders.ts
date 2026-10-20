import { db, type Folder } from '@/db/db'
import { uid } from '@/lib/id'
import { markDeleted } from '@/lib/tombstones'

/** 文档文件夹（v2.1）：长期任务的资料夹，任务 ↔ 文件夹双向链接 */

export async function createFolder(name: string, taskId?: string): Promise<Folder> {
  const now = Date.now()
  const folder: Folder = { id: uid(), name: name.trim() || '未命名文件夹', taskId, createdAt: now, updatedAt: now }
  await db.transaction('rw', [db.folders, db.tasks], async () => {
    await db.folders.add(folder)
    if (taskId) await db.tasks.update(taskId, { folderId: folder.id, updatedAt: now })
  })
  return folder
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await db.folders.update(id, { name: name.trim() || '未命名文件夹', updatedAt: Date.now() })
}

/** 删文件夹：文档与任务解除归属（不删内容），文件夹立墓碑供同步 */
export async function deleteFolder(id: string): Promise<void> {
  await db.transaction('rw', [db.folders, db.docs, db.tasks, db.tombstones], async () => {
    const docs = await db.docs.where('folderId').equals(id).toArray()
    for (const d of docs) await db.docs.update(d.id, { folderId: undefined })
    const tasks = await db.tasks.where('folderId').equals(id).toArray()
    for (const t of tasks) await db.tasks.update(t.id, { folderId: undefined, updatedAt: Date.now() })
    await db.folders.delete(id)
    await markDeleted(id)
  })
}

export async function setDocFolder(docId: string, folderId?: string): Promise<void> {
  await db.docs.update(docId, { folderId })
}

/** 任务关联文件夹：同一时间一个任务只挂一个夹；换夹时把旧夹的反向引用清掉 */
export async function linkTaskFolder(taskId: string, folderId?: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', [db.tasks, db.folders], async () => {
    const task = await db.tasks.get(taskId)
    const prev = task?.folderId
    await db.tasks.update(taskId, { folderId, updatedAt: now })
    if (prev && prev !== folderId) await db.folders.update(prev, { taskId: undefined, updatedAt: now })
    if (folderId) await db.folders.update(folderId, { taskId, updatedAt: now })
  })
}
