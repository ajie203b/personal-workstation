import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { daysFromToday, fmtDue, nextWeekday, todayStr } from './date'

/**
 * 固定「今天」= 2026-10-20（周二），本周（周一起）= 10-19 ~ 10-25。
 * 这样「下周一」「下下周」这类按自然周计算的语义才有唯一答案。
 */
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 20, 10, 30))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('todayStr', () => {
  it('取本地日期，不受 UTC 影响', () => {
    expect(todayStr()).toBe('2026-10-20')
    // 本地 0 点与 23 点都必须仍是同一天（toISOString 会在这里偏移）
    vi.setSystemTime(new Date(2026, 9, 20, 0, 5))
    expect(todayStr()).toBe('2026-10-20')
    vi.setSystemTime(new Date(2026, 9, 20, 23, 55))
    expect(todayStr()).toBe('2026-10-20')
  })
})

describe('nextWeekday', () => {
  it('不带「下周」时取最近的周几，含今天', () => {
    expect(nextWeekday(2, 0)).toBe('2026-10-20') // 今天周二
    expect(nextWeekday(3, 0)).toBe('2026-10-21') // 最近周三
    expect(nextWeekday(1, 0)).toBe('2026-10-26') // 本周一已过 → 下周一
    expect(nextWeekday(0, 0)).toBe('2026-10-25') // 周日
    expect(nextWeekday(5, 0)).toBe('2026-10-23')
  })

  it('「下周X」= 下一个自然周里的 X，不是最近的 X 再加 7 天', () => {
    // 今天周二，下周一是 10-26（旧实现给出 11-02）
    expect(nextWeekday(1, 1)).toBe('2026-10-26')
    expect(nextWeekday(3, 1)).toBe('2026-10-28')
    expect(nextWeekday(5, 1)).toBe('2026-10-30')
    expect(nextWeekday(6, 1)).toBe('2026-10-31')
    expect(nextWeekday(0, 1)).toBe('2026-11-01') // 下周日
  })

  it('「下下周X」再推一个自然周', () => {
    expect(nextWeekday(1, 2)).toBe('2026-11-02')
    expect(nextWeekday(3, 2)).toBe('2026-11-04')
    expect(nextWeekday(0, 2)).toBe('2026-11-08')
  })

  it('跨月/跨年也按自然周', () => {
    vi.setSystemTime(new Date(2026, 11, 30, 9, 0)) // 周三 12-30
    expect(nextWeekday(1, 1)).toBe('2027-01-04')
    expect(nextWeekday(5, 1)).toBe('2027-01-08')
  })
})

describe('fmtDue / daysFromToday', () => {
  it('逾期天数按本地日期算', () => {
    expect(daysFromToday('2026-10-20')).toBe(0)
    expect(daysFromToday('2026-10-21')).toBe(1)
    expect(daysFromToday('2026-10-15')).toBe(-5)
    expect(fmtDue('2026-10-15').text).toBe('逾期5天')
    expect(fmtDue('2026-10-15').overdue).toBe(true)
    expect(fmtDue('2026-10-21').text).toBe('明天')
    // 一周内显示周几
    expect(fmtDue('2026-10-23').text).toBe('周五')
  })
})
