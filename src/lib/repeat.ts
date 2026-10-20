import { addDays, format } from 'date-fns'

export type RepeatKind = 'daily' | 'weekly' | 'weekdays'

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

/**
 * 重复任务完成后的下一次截止日：从原 due 按周期推进，直到严格晚于今天。
 *
 * 逾期后才勾掉的重复任务不能把下一次生成为过去的日期：
 * 旧实现直接取「旧 due + 一个周期」，每天任务逾期 5 天后勾掉，生成的下一次仍然逾期 4 天，
 * 于是重复任务会越拖越多。现在推进到第一个未来日期（周末对 weekdays 再顺延）。
 */
export function nextDueForRepeat(due: string | undefined, repeat: RepeatKind, today: string): string {
  const step = repeat === 'weekly' ? 7 : 1
  let next = addDaysLocal(parseLocalDate(due ?? today), step)
  while (toDateStr(next) <= today) next = addDaysLocal(next, step)
  if (repeat === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next = addDaysLocal(next, 1)
  }
  return toDateStr(next)
}
