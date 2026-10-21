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

const { parseTimeOfDay, reminderDateFor } = await import('./notify')

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
