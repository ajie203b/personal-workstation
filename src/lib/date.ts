import { addDays, format, startOfWeek } from 'date-fns'

export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 本地时区的 YYYY-MM-DD */
export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/**
 * 未来任务：截止日期晚于今天，或开始时间还没到。
 * 这类任务不允许提前勾完成，避免把未来计划从清单里点没。
 */
export function isFutureTask(
  task: { due?: string; startAt?: number; status?: string },
  today = todayStr(),
  now = Date.now(),
): boolean {
  if (task.status === 'done') return false
  return (!!task.due && task.due > today) || (task.startAt != null && task.startAt > now)
}

export function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** '2026-10-02' → Date（本地时区当天 0 点） */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 距今天数：0=今天，负数=过去 */
export function daysFromToday(dateStr: string): number {
  const a = parseDateStr(dateStr).getTime()
  const b = parseDateStr(todayStr()).getTime()
  return Math.round((a - b) / 86400000)
}

export interface DueLabel {
  text: string
  overdue: boolean
  isToday: boolean
}

/** 截止日期的中文短标签：今天 / 明天 / 周四 / 10月8日 */
export function fmtDue(due: string, time?: string | null): DueLabel {
  const diff = daysFromToday(due)
  const t = time ? ` ${time}` : ''
  if (diff === 0) return { text: `今天${t}`, overdue: false, isToday: true }
  if (diff === 1) return { text: `明天${t}`, overdue: false, isToday: false }
  if (diff === -1) return { text: `昨天${t}`, overdue: true, isToday: false }
  if (diff < 0) return { text: `逾期${-diff}天${t}`, overdue: true, isToday: false }
  if (diff <= 6) {
    const wd = WEEKDAY_CN[parseDateStr(due).getDay()]
    return { text: `${wd}${t}`, overdue: false, isToday: false }
  }
  const d = parseDateStr(due)
  return { text: `${d.getMonth() + 1}月${d.getDate()}日${t}`, overdue: false, isToday: false }
}

export function fmtWeekdayLong(d: Date = new Date()): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_CN[d.getDay()]}`
}

/** 本周（周一起）完成数 */
export function isThisWeek(ts: number): boolean {
  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  return ts >= weekStart.getTime() && ts <= now.getTime() + 86400000
}

export function addDaysStr(n: number, from: Date = new Date()): string {
  return toDateStr(addDays(from, n))
}

/**
 * 下一个周几（0=周日…6=周六）。
 * weeksAhead=0：最近的周几（含今天）；1 / 2 表示「下周 / 下下周」——
 * 按自然周（周一起）取那一周的周几，而不是「最近的周几再加 7 天」。
 * 旧写法在周二算「下周一」会先取到本周一（已过 → 下周一 10-26）再加 7 天，得到 11-02。
 */
export function nextWeekday(target: number, weeksAhead = 0): string {
  const today = new Date()
  if (weeksAhead === 0) {
    return toDateStr(addDays(today, (target - today.getDay() + 7) % 7))
  }
  const monday = startOfWeek(today, { weekStartsOn: 1 })
  const fromMonday = (target - 1 + 7) % 7 // 周一=0 … 周日=6
  return toDateStr(addDays(monday, weeksAhead * 7 + fromMonday))
}

export const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}
