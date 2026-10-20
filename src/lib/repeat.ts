import { addDays, format } from 'date-fns'

export type RepeatKind = 'daily' | 'weekly' | 'weekdays' | 'monthly'

/** 重复任务的额外日程：每周指定几天，或每月指定几号 */
export interface RepeatSchedule {
  /** 每周重复的星期（0=周日…6=周六）；「每周一三五」→ [1,3,5] */
  days?: number[]
  /** 每月重复的日号；「每月15号」→ 15 */
  monthDay?: number
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** 重复规则的中文标签：「每周三」「每周一三五」「每月15号」 */
export function repeatLabel(kind: RepeatKind, sched: RepeatSchedule = {}): string {
  if (kind === 'daily') return '每天'
  if (kind === 'weekdays') return '工作日'
  if (kind === 'monthly') {
    return sched.monthDay ? `每月${sched.monthDay}号` : '每月'
  }
  const days = sched.days?.length ? [...sched.days].sort((a, b) => a - b) : []
  if (days.length === 1) return `每周${WEEKDAY_CN[days[0]]}`
  if (days.length > 1) return `每周${days.map((d) => WEEKDAY_CN[d]).join('')}`
  return '每周'
}

function addDaysLocal(d: Date, n: number): Date {
  return addDays(d, n)
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** 某年某月的天数 */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

/**
 * 重复任务完成后的下一次截止日：从原 due 按周期推进，直到严格晚于今天。
 *
 * 逾期后才勾掉的重复任务不能把下一次生成为过去的日期：
 * 旧实现直接取「旧 due + 一个周期」，每天任务逾期 5 天后勾掉，生成的下一次仍然逾期 4 天，
 * 于是重复任务会越拖越多。现在推进到第一个未来日期（周末对 weekdays 再顺延）。
 *
 * sched 用于两种细化周期：
 * - weekly + days：「每周一三五」→ 取下一个命中集合里的日子，而不是固定 +7 天
 * - monthly + monthDay：「每月15号」→ 逐月推进，日号超出当月天数时收敛到当月最后一天
 */
export function nextDueForRepeat(
  due: string | undefined,
  repeat: RepeatKind,
  today: string,
  sched: RepeatSchedule = {},
): string {
  if (repeat === 'monthly') {
    const day = sched.monthDay ?? parseLocalDate(due ?? today).getDate()
    const ref = parseLocalDate(due ?? today)
    let y = ref.getFullYear()
    let m = ref.getMonth()
    for (let i = 0; i < 36; i++) {
      m += 1
      if (m > 11) { m = 0; y += 1 }
      const cand = toDateStr(new Date(y, m, Math.min(day, daysInMonth(y, m))))
      if (cand > today) return cand
    }
    // 36 个月都没算出未来日期只可能是日期串坏掉了，退化成明天
    return addDaysStrSafe(today, 1)
  }

  if (repeat === 'weekly' && sched.days?.length) {
    const days = [...new Set(sched.days)].sort((a, b) => a - b)
    let d = addDaysLocal(parseLocalDate(due ?? today), 1)
    for (let i = 0; i < 14; i++) {
      const s = toDateStr(d)
      if (s > today && days.includes(d.getDay())) return s
      d = addDaysLocal(d, 1)
    }
    return addDaysStrSafe(today, 7)
  }

  const step = repeat === 'weekly' ? 7 : 1
  let next = addDaysLocal(parseLocalDate(due ?? today), step)
  while (toDateStr(next) <= today) next = addDaysLocal(next, step)
  if (repeat === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next = addDaysLocal(next, 1)
  }
  return toDateStr(next)
}

function addDaysStrSafe(from: string, n: number): string {
  return toDateStr(addDaysLocal(parseLocalDate(from), n))
}
