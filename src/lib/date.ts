import { addDays, format, startOfWeek } from 'date-fns'

export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 本地时区的 YYYY-MM-DD */
export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
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

/** 下一个周几（0=周日…6=周六；含今天；weeksAhead=1 表示「下周」） */
export function nextWeekday(target: number, weeksAhead = 0): string {
  const today = new Date()
  let diff = (target - today.getDay() + 7) % 7
  if (diff === 0 && weeksAhead > 0) diff = 7
  return toDateStr(addDays(today, diff + weeksAhead * 7))
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
