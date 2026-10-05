import { db, type Priority, type Task, type Tier } from './db'
import { uid } from '@/lib/id'
import { addDaysStr, todayStr } from '@/lib/date'

export interface NewTaskInput {
  title: string
  tier: Tier
  priority?: Priority
  due?: string
  dueTime?: string
  tags?: string[]
  notes?: string
  repeat?: Task['repeat']
  status?: Task['status']
  docRef?: Task['docRef']
  aiRef?: string
}

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
    docRef: input.docRef,
    aiRef: input.aiRef,
    createdAt: now,
    updatedAt: now,
  }
  await db.tasks.add(task)
  return task
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: Date.now() })
}

/** 勾选完成 / 恢复。完成时事务内写 doneAt + 生成下一次；恢复时事务内回收已生成的下一次 */
export async function toggleDone(task: Task): Promise<void> {
  if (task.status === 'done') {
    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.update(task.id, { status: 'todo', doneAt: undefined, updatedAt: Date.now() })
      if (!task.repeat) return
      const base = task.due ?? todayStr()
      let nextDue: string
      if (task.repeat === 'daily') nextDue = addDaysStr(1, new Date(base + 'T00:00:00'))
      else if (task.repeat === 'weekly') nextDue = addDaysStr(7, new Date(base + 'T00:00:00'))
      else {
        let d = new Date(base + 'T00:00:00')
        do { d = new Date(d.getTime() + 86400000) } while (d.getDay() === 0 || d.getDay() === 6)
        nextDue = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      const spawned = await db.tasks
        .filter((t) => t.title === task.title && t.repeat === task.repeat && t.due === nextDue && t.status === 'todo' && t.createdAt > (task.doneAt ?? 0) && t.id !== task.id)
        .toArray()
      if (spawned.length) await db.tasks.bulkDelete(spawned.map((t) => t.id))
    })
    return
  }
  await db.transaction('rw', db.tasks, async () => {
    const now = Date.now()
    await db.tasks.update(task.id, { status: 'done', doneAt: now, updatedAt: now })
    if (!task.repeat) return
    const base = task.due ?? todayStr()
    let nextDue: string
    if (task.repeat === 'daily') {
      nextDue = addDaysStr(1, new Date(base + 'T00:00:00'))
    } else if (task.repeat === 'weekly') {
      nextDue = addDaysStr(7, new Date(base + 'T00:00:00'))
    } else {
      let d = new Date(base + 'T00:00:00')
      do { d = new Date(d.getTime() + 86400000) } while (d.getDay() === 0 || d.getDay() === 6)
      nextDue = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
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
      docRef: task.docRef,
      aiRef: task.aiRef,
      createdAt: now,
      updatedAt: now,
    }
    await db.tasks.add(next)
  })
}

export async function moveTier(id: string, tier: Tier): Promise<void> {
  await updateTask(id, { tier })
}

export async function setPriority(id: string, priority: Priority): Promise<void> {
  await updateTask(id, { priority })
}

/** 删除：返回快照供撤销 */
export async function deleteTask(task: Task): Promise<Task> {
  await db.tasks.delete(task.id)
  return task
}

export async function restoreTask(task: Task): Promise<void> {
  await db.tasks.put(task)
}

/** 排序：优先级 P0→P3，其次截止日期，再者创建时间 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const ad = a.due ?? '9999-12-31'
    const bd = b.due ?? '9999-12-31'
    if (ad !== bd) return ad < bd ? -1 : 1
    if ((a.dueTime ?? '') !== (b.dueTime ?? '')) return (a.dueTime ?? '') < (b.dueTime ?? '') ? -1 : 1
    return b.createdAt - a.createdAt
  })
}

export async function exportAll(): Promise<string> {
  const [tasks, settings, docs, blobs, positions, annotations, bookmarks, aiProviders, aiSessions, aiMessages, aiUsage] = await Promise.all([
    db.tasks.toArray(),
    db.settings.toArray(),
    db.docs.toArray(),
    db.blobs.toArray(),
    db.positions.toArray(),
    db.annotations.toArray(),
    db.bookmarks.toArray(),
    db.aiProviders.toArray(),
    db.aiSessions.toArray(),
    db.aiMessages.toArray(),
    db.aiUsage.toArray(),
  ])
  const blobRows = await Promise.all(
    blobs.map(async (row) => ({
      hash: row.hash,
      type: row.blob.type,
      data: await blobToBase64(row.blob),
    })),
  )
  return JSON.stringify(
    { app: 'personal-workstation', version: 3, exportedAt: new Date().toISOString(), tasks, settings, docs, blobRows, positions, annotations, bookmarks, aiProviders, aiSessions, aiMessages, aiUsage },
    null, 2,
  )
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
}

export async function importAll(json: string): Promise<ImportResult> {
  const data = JSON.parse(json) as {
    tasks?: Task[]
    settings?: { key: string; value: unknown }[]
    docs?: import('./db').Doc[]
    blobRows?: { hash: string; type: string; data: string }[]
    positions?: import('./db').ReadingPosition[]
    annotations?: import('./db').Annotation[]
    bookmarks?: import('./db').Bookmark[]
    aiProviders?: import('./db').AiProvider[]
    aiSessions?: import('./db').AiSession[]
    aiMessages?: import('./db').AiMessage[]
    aiUsage?: import('./db').AiUsageRow[]
  }
  if (!Array.isArray(data.tasks)) throw new Error('文件格式不正确：缺少 tasks 数组')
  const result: ImportResult = { tasks: 0, settings: 0, docs: 0 }
  await db.transaction(
    'rw',
    [db.tasks, db.settings, db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.aiProviders, db.aiSessions, db.aiMessages, db.aiUsage],
    async () => {
      if (data.tasks!.length) {
        await db.tasks.bulkPut(data.tasks!)
        result.tasks = data.tasks!.length
      }
      if (Array.isArray(data.settings) && data.settings.length) {
        await db.settings.bulkPut(data.settings)
        result.settings = data.settings.length
      }
      if (Array.isArray(data.docs)) {
        await db.docs.bulkPut(data.docs)
        result.docs = data.docs.length
      }
      if (Array.isArray(data.blobRows) && data.blobRows.length) {
        await db.blobs.bulkPut(data.blobRows.map((r) => ({ hash: r.hash, blob: base64ToBlob(r.data, r.type) })))
      }
      if (Array.isArray(data.positions)) await db.positions.bulkPut(data.positions)
      if (Array.isArray(data.annotations)) await db.annotations.bulkPut(data.annotations)
      if (Array.isArray(data.bookmarks)) await db.bookmarks.bulkPut(data.bookmarks)
      if (Array.isArray(data.aiProviders)) await db.aiProviders.bulkPut(data.aiProviders)
      if (Array.isArray(data.aiSessions)) await db.aiSessions.bulkPut(data.aiSessions)
      if (Array.isArray(data.aiMessages)) await db.aiMessages.bulkPut(data.aiMessages)
      if (Array.isArray(data.aiUsage)) await db.aiUsage.bulkPut(data.aiUsage)
    },
  )
  return result
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.tasks, db.settings, db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.aiProviders, db.aiSessions, db.aiMessages, db.aiUsage],
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
      localStorage.removeItem('ws-doc-tabs')
    },
  )
}
