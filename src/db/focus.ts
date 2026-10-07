import { db, type FocusSession } from './db'
import { uid } from '@/lib/id'
import { todayStr } from '@/lib/date'

/** 专注会话（v1.3）：番茄钟每次完成落库，可绑定任务 */

const LEGACY_KEY = 'ws-focus-records'

export async function addFocusSession(minutes: number, taskId?: string): Promise<void> {
  const row: FocusSession = { id: uid(), day: todayStr(), ts: Date.now(), minutes, taskId: taskId || undefined }
  await db.focusSessions.add(row)
}

/** 旧版 localStorage 每日统计 → focusSessions（一次性迁移） */
export async function migrateLegacyFocusRecords(): Promise<void> {
  let raw: string | null = null
  try { raw = localStorage.getItem(LEGACY_KEY) } catch { /* ignore */ }
  if (!raw) return
  try {
    const all = JSON.parse(raw) as Record<string, { date: string; sessions: number; minutes: number }>
    const rows: FocusSession[] = []
    for (const rec of Object.values(all)) {
      if (!rec?.date || !rec.minutes) continue
      for (let i = 0; i < rec.sessions; i++) {
        rows.push({ id: uid(), day: rec.date, ts: new Date(`${rec.date}T23:59:00`).getTime(), minutes: Math.round(rec.minutes / rec.sessions), taskId: undefined })
      }
    }
    if (rows.length) await db.focusSessions.bulkAdd(rows)
    localStorage.removeItem(LEGACY_KEY)
  } catch { /* 损坏数据直接丢弃 */ }
}
