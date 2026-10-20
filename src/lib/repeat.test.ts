import { describe, expect, it } from 'vitest'
import { nextDueForRepeat } from './repeat'

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
})
