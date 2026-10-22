import { describe, expect, it, vi } from 'vitest'

// notify.ts 顶部就 import 了原生插件：单测跑在 node 里，这里替换成空实现
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: async () => undefined,
    schedule: async () => undefined,
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
  },
}))

const { parseTimeOfDay, reminderDateFor, reminderDatesFor } = await import('./notify')

describe('reminderDateFor', () => {
  it('00:30 就是当天 00:30（旧实现被算成 09:30）', () => {
    const at = reminderDateFor({ due: '2026-10-21', dueTime: '00:30' })
    expect(at).not.toBeNull()
    expect(at!.getHours()).toBe(0)
    expect(at!.getMinutes()).toBe(30)
    expect(at!.getDate()).toBe(21)
  })

  it('00:00 不被当成「没填时间」', () => {
    const at = reminderDateFor({ due: '2026-10-21', dueTime: '00:00' })
    expect(at!.getHours()).toBe(0)
    expect(at!.getMinutes()).toBe(0)
  })

  it('没有 dueTime 时默认 09:00', () => {
    const at = reminderDateFor({ due: '2026-10-21' })
    expect(at!.getHours()).toBe(9)
    expect(at!.getMinutes()).toBe(0)
  })

  it('时间非法时退回 09:00', () => {
    expect(parseTimeOfDay('24:00')).toEqual({ hh: 9, mm: 0 })
    expect(parseTimeOfDay('12:60')).toEqual({ hh: 9, mm: 0 })
    expect(parseTimeOfDay('abc')).toEqual({ hh: 9, mm: 0 })
    expect(parseTimeOfDay('7:05')).toEqual({ hh: 7, mm: 5 })
  })

  it('没有截止日就不排提醒', () => {
    expect(reminderDateFor({ due: undefined, dueTime: '00:30' })).toBeNull()
    expect(reminderDateFor({ due: '2026-10', dueTime: '00:30' })).toBeNull()
  })
})

describe('reminderDatesFor（打卡任务多个时间点）', () => {
  it('两个时间点各排一条', () => {
    const list = reminderDatesFor({
      due: '2026-10-21',
      dueTime: '08:00',
      repeatTimes: ['08:00', '21:00'],
    })
    expect(list.map((d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`)).toEqual(['8:00', '21:00'])
    expect(list.every((d) => d.getDate() === 21)).toBe(true)
  })

  it('没有 repeatTimes 时退回 dueTime', () => {
    const list = reminderDatesFor({ due: '2026-10-21', dueTime: '07:15' })
    expect(list).toHaveLength(1)
    expect(list[0].getHours()).toBe(7)
  })

  it('没有截止日 → 空数组', () => {
    expect(reminderDatesFor({ due: undefined, dueTime: '08:00' })).toEqual([])
  })

  it('超过 4 个时间点只排前 4 个', () => {
    const list = reminderDatesFor({
      due: '2026-10-21',
      repeatTimes: ['01:00', '05:00', '09:00', '13:00', '17:00', '21:00'],
    })
    expect(list).toHaveLength(4)
  })
})
