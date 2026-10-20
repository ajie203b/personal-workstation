import { describe, expect, it } from 'vitest'
import { nextDueForRepeat, repeatLabel } from './repeat'

/** 今天固定 2026-10-20（周二），所有断言都显式传 today，不依赖系统时间 */
const TODAY = '2026-10-20'

describe('nextDueForRepeat', () => {
  describe('daily', () => {
    it('今天到期，下一次是明天', () => {
      expect(nextDueForRepeat('2026-10-20', 'daily', TODAY)).toBe('2026-10-21')
    })
    it('逾期 5 天后勾掉，下一次是明天而不是逾期 4 天', () => {
      expect(nextDueForRepeat('2026-10-15', 'daily', TODAY)).toBe('2026-10-21')
    })
    it('没有 due 时从今天算起', () => {
      expect(nextDueForRepeat(undefined, 'daily', TODAY)).toBe('2026-10-21')
    })
    it('提前勾掉未来任务，只推进一个周期', () => {
      expect(nextDueForRepeat('2026-10-23', 'daily', TODAY)).toBe('2026-10-24')
    })
  })

  describe('weekly', () => {
    it('今天到期 → 下周同一天', () => {
      expect(nextDueForRepeat('2026-10-20', 'weekly', TODAY)).toBe('2026-10-27')
    })
    it('逾期两周多 → 推进到最近一个未来周期', () => {
      expect(nextDueForRepeat('2026-10-01', 'weekly', TODAY)).toBe('2026-10-22')
    })
    it('逾期 1 天 → 仍是本周的未来那天', () => {
      expect(nextDueForRepeat('2026-10-15', 'weekly', TODAY)).toBe('2026-10-22')
    })
    it('昨天到期 → 下周', () => {
      expect(nextDueForRepeat('2026-10-19', 'weekly', TODAY)).toBe('2026-10-26')
    })
  })

  describe('weekdays', () => {
    it('今天到期 → 明天（工作日）', () => {
      expect(nextDueForRepeat('2026-10-20', 'weekdays', TODAY)).toBe('2026-10-21')
    })
    it('周五到期、周二才勾掉 → 下一个工作日是明天', () => {
      expect(nextDueForRepeat('2026-10-16', 'weekdays', TODAY)).toBe('2026-10-21')
    })
    it('未来周五 → 跳过周末到周一', () => {
      expect(nextDueForRepeat('2026-10-23', 'weekdays', TODAY)).toBe('2026-10-26')
    })
    it('未来周四 → 周五', () => {
      expect(nextDueForRepeat('2026-10-22', 'weekdays', TODAY)).toBe('2026-10-23')
    })
    it('逾期周一 → 明天', () => {
      expect(nextDueForRepeat('2026-10-19', 'weekdays', TODAY)).toBe('2026-10-21')
    })
  })

  describe('weekly 多天（每周一三五）', () => {
    const sched = { days: [1, 3, 5] }
    it('周三勾掉 → 下一个是周五', () => {
      expect(nextDueForRepeat('2026-10-21', 'weekly', TODAY, sched)).toBe('2026-10-23')
    })
    it('周五勾掉 → 跳到下周一', () => {
      expect(nextDueForRepeat('2026-10-23', 'weekly', TODAY, sched)).toBe('2026-10-26')
    })
    it('逾期到周二才勾掉 → 周三', () => {
      expect(nextDueForRepeat('2026-10-19', 'weekly', TODAY, sched)).toBe('2026-10-21')
    })
    it('没有 due 时从今天往后找', () => {
      expect(nextDueForRepeat(undefined, 'weekly', TODAY, sched)).toBe('2026-10-21')
    })
  })

  describe('monthly（每月15号）', () => {
    const sched = { monthDay: 15 }
    it('本月 15 号已过、今天 20 号勾掉 → 下月 15 号', () => {
      expect(nextDueForRepeat('2026-10-15', 'monthly', TODAY, sched)).toBe('2026-11-15')
    })
    it('提前勾掉 11-15 的任务 → 推到 12-15', () => {
      expect(nextDueForRepeat('2026-11-15', 'monthly', '2026-11-01', sched)).toBe('2026-12-15')
    })
    it('31 号遇到小月收敛到月末', () => {
      expect(nextDueForRepeat('2027-01-31', 'monthly', '2027-02-01', { monthDay: 31 })).toBe('2027-02-28')
    })
    it('跨年', () => {
      expect(nextDueForRepeat('2026-12-15', 'monthly', '2026-12-20', sched)).toBe('2027-01-15')
    })
    it('没有 monthDay 时沿用原 due 的日号', () => {
      expect(nextDueForRepeat('2026-10-08', 'monthly', TODAY)).toBe('2026-11-08')
    })
  })

  describe('repeatLabel', () => {
    it('单天 / 多天 / 每月', () => {
      expect(repeatLabel('weekly', { days: [3] })).toBe('每周三')
      expect(repeatLabel('weekly', { days: [1, 3, 5] })).toBe('每周一三五')
      expect(repeatLabel('monthly', { monthDay: 15 })).toBe('每月15号')
      expect(repeatLabel('weekdays')).toBe('工作日')
    })
  })
})
