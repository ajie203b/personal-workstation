import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseQuickAdd } from './nlp'

/** 固定「今天」= 2026-10-20（周二），本周一 = 10-19 */
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 20, 10, 30))
})
afterEach(() => {
  vi.useRealTimers()
})

const parse = (s: string) => parseQuickAdd(s)

describe('完整例子', () => {
  it('明天14:00 交报告 P1 #工作', () => {
    expect(parse('明天14:00 交报告 P1 #工作')).toMatchObject({
      title: '交报告', due: '2026-10-21', dueTime: '14:00', priority: 1, tags: ['工作'],
    })
  })

  it('周五前交作业：吃掉截止词「前」', () => {
    expect(parse('周五前交作业')).toMatchObject({ title: '交作业', due: '2026-10-23' })
  })

  it('下周三前提交', () => {
    expect(parse('下周三前 提交')).toMatchObject({ title: '提交', due: '2026-10-28' })
  })
})

describe('下周一 / 下下周', () => {
  it('下周一按自然周算（今天周二 → 10-26，不是 11-02）', () => {
    expect(parse('下周一 组会')).toMatchObject({ title: '组会', due: '2026-10-26' })
  })
  it('下下周一 → 11-02', () => {
    expect(parse('下下周一 组会')).toMatchObject({ title: '组会', due: '2026-11-02' })
  })
  it('下周三 → 10-28', () => {
    expect(parse('下周三 评审')).toMatchObject({ title: '评审', due: '2026-10-28' })
  })
  it('周日（本周还没到）→ 10-25', () => {
    expect(parse('周日 爬山')).toMatchObject({ title: '爬山', due: '2026-10-25' })
  })
})

describe('重复任务', () => {
  it('每周三 打球：不被归一化拆成「每周 三」', () => {
    expect(parse('每周三 打球')).toMatchObject({
      title: '打球', repeat: 'weekly', due: '2026-10-21',
    })
  })
  it('每周三打球（不带空格）也一样', () => {
    expect(parse('每周三打球')).toMatchObject({
      title: '打球', repeat: 'weekly', due: '2026-10-21',
    })
  })
  it('每周 复盘：不带周几，只有周期', () => {
    const p = parse('每周 复盘')
    expect(p).toMatchObject({ title: '复盘', repeat: 'weekly' })
    expect(p.due).toBeUndefined()
  })
  it('每天 喝水', () => {
    const p = parse('每天 喝水')
    expect(p).toMatchObject({ title: '喝水', repeat: 'daily' })
  })
  it('工作日 打卡', () => {
    expect(parse('工作日 打卡')).toMatchObject({ title: '打卡', repeat: 'weekdays' })
  })
  it('组合写法', () => {
    expect(parse('每周三 打球 P2 #运动')).toMatchObject({
      title: '打球', repeat: 'weekly', due: '2026-10-21', priority: 2, tags: ['运动'],
    })
  })
})

describe('时间', () => {
  it('3点半复诊 → 15:30（无时段 1–6 点默认下午）', () => {
    expect(parse('3点半复诊')).toMatchObject({ title: '复诊', dueTime: '15:30' })
  })
  it('2点 开会 → 14:00', () => {
    expect(parse('2点 开会')).toMatchObject({ title: '开会', dueTime: '14:00' })
  })
  it('3点开会（连写）→ 15:00', () => {
    expect(parse('3点开会')).toMatchObject({ title: '开会', dueTime: '15:00' })
  })
  it('凌晨2点 看球 → 02:00', () => {
    expect(parse('凌晨2点 看球')).toMatchObject({ title: '看球', dueTime: '02:00' })
  })
  it('上午9点 站会 → 09:00', () => {
    expect(parse('上午9点 站会')).toMatchObject({ title: '站会', dueTime: '09:00' })
  })
  it('下午3点 评审 → 15:00', () => {
    expect(parse('下午3点 评审')).toMatchObject({ title: '评审', dueTime: '15:00' })
  })
  it('晚上8点 跑步 → 20:00', () => {
    expect(parse('晚上8点 跑步')).toMatchObject({ title: '跑步', dueTime: '20:00' })
  })
  it('下午三点 复盘 → 15:00', () => {
    expect(parse('下午三点 复盘')).toMatchObject({ title: '复盘', dueTime: '15:00' })
  })
  it('7 点仍是早上，不擅自加 12（只处理 1–6 点）', () => {
    expect(parse('7点 跑步')).toMatchObject({ title: '跑步', dueTime: '07:00' })
  })
  it('明天下午3点开会', () => {
    expect(parse('明天下午3点开会')).toMatchObject({
      title: '开会', due: '2026-10-21', dueTime: '15:00',
    })
  })
  it('读第3点笔记：「第3点」不是时间', () => {
    const p = parse('读第3点笔记')
    expect(p.dueTime).toBeUndefined()
    expect(p.title).toBe('读第3点笔记')
  })
})

describe('日期', () => {
  it('7-11 买咖啡：不当成 7 月 11 日', () => {
    const p = parse('7-11 买咖啡')
    expect(p.due).toBeUndefined()
    expect(p.title).toBe('7-11 买咖啡')
  })
  it('12-25 圣诞：有一边大于 12 才按日期', () => {
    expect(parse('12-25 圣诞')).toMatchObject({ title: '圣诞', due: '2026-12-25' })
  })
  it('10月8日 已过 → 明年', () => {
    expect(parse('10月8日 交房租')).toMatchObject({ title: '交房租', due: '2027-10-08' })
  })
  it('3天后 复查', () => {
    expect(parse('3天后 复查')).toMatchObject({ title: '复查', due: '2026-10-23' })
  })
  it('明天 交报告', () => {
    expect(parse('明天 交报告')).toMatchObject({ title: '交报告', due: '2026-10-21' })
  })
  it('2026-11-05 体检：显式年月日', () => {
    expect(parse('2026-11-05 体检')).toMatchObject({ title: '体检', due: '2026-11-05' })
  })
})

describe('优先级连写', () => {
  it('P1交报告（开头连写）', () => {
    expect(parse('P1交报告')).toMatchObject({ title: '交报告', priority: 1 })
  })
  it('报告P1（结尾连写，原支持）', () => {
    expect(parse('报告P1')).toMatchObject({ title: '报告', priority: 1 })
  })
  it('p2p 这类英文词不会被当成优先级', () => {
    const p = parse('p2p 调试')
    expect(p.priority).toBeUndefined()
    expect(p.title).toBe('p2p 调试')
  })
  it('全角 Ｐ1', () => {
    expect(parse('交报告 Ｐ1')).toMatchObject({ title: '交报告', priority: 1 })
  })
})

describe('不该误伤', () => {
  it('普通句子原样保留', () => {
    const p = parse('整理一下上季度的复盘材料')
    expect(p.title).toBe('整理一下上季度的复盘材料')
    expect(p.due).toBeUndefined()
    expect(p.dueTime).toBeUndefined()
  })
  it('没有标题时回退到原文', () => {
    expect(parse('明天').title).toBe('明天')
  })
})
