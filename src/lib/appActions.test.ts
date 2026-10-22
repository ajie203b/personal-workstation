import { describe, expect, it } from 'vitest'
import { parseAppUrl, routeForNotification } from './appActions'

describe('parseAppUrl', () => {
  it('快捷方式：快速添加', () => {
    expect(parseAppUrl('com.personal.workstation://quickadd')).toBe('/today?quickadd=1')
  })
  it('快捷方式：今日（带尾斜杠也认）', () => {
    expect(parseAppUrl('com.personal.workstation://today')).toBe('/today')
    expect(parseAppUrl('com.personal.workstation://today/')).toBe('/today')
  })
  it('大小写不敏感', () => {
    expect(parseAppUrl('com.personal.workstation://QUICKADD')).toBe('/today?quickadd=1')
  })
  it('小组件点单条任务 → 定位到该任务', () => {
    expect(parseAppUrl('com.personal.workstation://task?id=abc123')).toBe('/tasks?focus=abc123')
    expect(parseAppUrl('com.personal.workstation://task')).toBe('/today')
  })
  it('任务 id 里的特殊字符要转义', () => {
    expect(parseAppUrl('com.personal.workstation://task?id=a%26b')).toBe('/tasks?focus=a%26b')
  })
  it('不认识的地址返回 null', () => {
    expect(parseAppUrl('com.personal.workstation://unknown')).toBeNull()
    expect(parseAppUrl('https://example.com/quickadd')).toBeNull()
    expect(parseAppUrl('')).toBeNull()
  })
})

describe('routeForNotification', () => {
  it('任务提醒 → 任务详情深链', () => {
    expect(routeForNotification({ taskId: 't1', tier: 'today' })).toBe('/tasks?tier=today&focus=t1')
    expect(routeForNotification({ taskId: 't1', tier: 'anytime' })).toBe('/tasks?tier=anytime&focus=t1')
  })
  it('缺 tier 时回落到 today', () => {
    expect(routeForNotification({ taskId: 't1' })).toBe('/tasks?tier=today&focus=t1')
  })
  it('番茄钟结束 → 今日页', () => {
    expect(routeForNotification({ focus: true })).toBe('/today')
  })
  it('没有可跳转的信息返回 null', () => {
    expect(routeForNotification({})).toBeNull()
    expect(routeForNotification(null)).toBeNull()
    expect(routeForNotification('x')).toBeNull()
  })
})
