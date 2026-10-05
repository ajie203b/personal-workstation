import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Annotation, type Doc, type Task } from './db'
import { todayStr } from '@/lib/date'

const EMPTY: Task[] = []

/** 当前日期 tick：60s + visibilitychange 校准，防跨零点冻结 */
export function useDateTick(): string {
  const [today, setToday] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })
  useEffect(() => {
    const check = () => {
      const d = new Date()
      const s = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      setToday((prev) => (prev === s ? prev : s))
    }
    const timer = setInterval(check, 60000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [])
  return today
}

/** 全量任务（个人规模足够快），派生数据用 useMemo 计算 */
export function useAllTasks(): Task[] {
  return useLiveQuery(() => db.tasks.orderBy('updatedAt').reverse().toArray(), [], EMPTY)
}

export function deriveActive(all: Task[]): Task[] {
  return all.filter((t) => t.status !== 'done')
}

export function deriveDone(all: Task[]): Task[] {
  return all
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
}

export function deriveToday(all: Task[], today?: string): Task[] {
  const t = today ?? todayStr()
  return all.filter((task) => task.status !== 'done' && (task.tier === 'today' || (task.due != null && task.due <= t)))
}

export function deriveTodayDone(all: Task[], today?: string): Task[] {
  const t = today ?? todayStr()
  const start = new Date(t + 'T00:00:00').getTime()
  return all.filter((task) => task.status === 'done' && (task.doneAt ?? 0) >= start)
}

export function countByTier(all: Task[]): Record<string, number> {
  const counts: Record<string, number> = { today: 0, upcoming: 0, anytime: 0, someday: 0 }
  for (const t of all) if (t.status !== 'done') counts[t.tier]++
  return counts
}

/* ============ 文档工作站 ============ */

const EMPTY_DOCS: Doc[] = []
const EMPTY_ANNS: Annotation[] = []

export function useDocs(): Doc[] {
  // 不能用 orderBy(lastOpenedAt)：未打开过的文档该字段为 undefined 不会进索引
  return useLiveQuery(
    async () => {
      const all = await db.docs.toArray()
      return all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
    },
    [],
    EMPTY_DOCS,
  )
}

export function useDoc(id: string | undefined): Doc | undefined {
  return useLiveQuery(
    () => (id ? db.docs.get(id) : undefined),
    [id],
    undefined,
  )
}

export function useAnnotations(docHash: string | undefined): Annotation[] {
  return useLiveQuery(
    () =>
      docHash
        ? db.annotations.where('docHash').equals(docHash).sortBy('createdAt')
        : Promise.resolve(EMPTY_ANNS),
    [docHash],
    EMPTY_ANNS,
  )
}

/** 反向链接：引用了当前文档的任务（可逆查询，方案 2.2） */
export function useDocBacklinks(docId: string | undefined): Task[] {
  return useLiveQuery(
    () =>
      docId
        ? db.tasks.filter((t) => t.docRef?.docId === docId && t.status !== 'done').toArray()
        : Promise.resolve([] as Task[]),
    [docId],
    [] as Task[],
  )
}

/** 今日页「最近阅读」 */
export function useRecentDocs(limit = 3): Doc[] {
  return useLiveQuery(
    async () => {
      const all = await db.docs.orderBy('lastOpenedAt').reverse().toArray()
      return all.filter((d) => d.lastOpenedAt).slice(0, limit)
    },
    [limit],
    EMPTY_DOCS,
  )
}
