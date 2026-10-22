import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inferTier, parseQuickAdd, parseSummary } from './nlp'

/** 固定「今天」= 2026-10-20（周二）10:30，本周一 = 10-19 */
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 20, 10, 30))
})
afterEach(() => {
  vi.useRealTimers()
})

const parse = (s: string) => parseQuickAdd(s)
/** 换一个「现在」再解析，用来验证时间推断跟当前时刻的关系 */
const parseAt = (h: number, m: number, s: string) => {
  vi.setSystemTime(new Date(2026, 9, 20, h, m))
  return parseQuickAdd(s)
}

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

describe('这周五 / 下个月1号', () => {
  it('这周五 → 本周五 10-23，标题不留「这周」', () => {
    expect(parse('这周五 交材料')).toMatchObject({ title: '交材料', due: '2026-10-23' })
  })
  it('这周五前交材料：吃掉截止词', () => {
    expect(parse('这周五前交材料')).toMatchObject({ title: '交材料', due: '2026-10-23' })
  })
  it('「这周一」已经过了 → 顺延到下周一，不生成过去日期', () => {
    expect(parse('这周一 补材料')).toMatchObject({ title: '补材料', due: '2026-10-26' })
  })
  it('下个月1号 → 11-01', () => {
    expect(parse('下个月1号 交报表')).toMatchObject({ title: '交报表', due: '2026-11-01' })
  })
  it('下月十五号（中文数字）→ 11-15', () => {
    expect(parse('下月十五号 交房租')).toMatchObject({ title: '交房租', due: '2026-11-15' })
  })
})

describe('重复任务', () => {
  it('每周三 打球：不被归一化拆成「每周 三」', () => {
    expect(parse('每周三 打球')).toMatchObject({
      title: '打球', repeat: 'weekly', repeatDays: [3], due: '2026-10-21',
    })
  })
  it('每周三打球（不带空格）也一样', () => {
    expect(parse('每周三打球')).toMatchObject({
      title: '打球', repeat: 'weekly', due: '2026-10-21',
    })
  })
  it('每周一三五 健身：多天一起认，标题里不留「三五」', () => {
    expect(parse('每周一三五 健身')).toMatchObject({
      title: '健身', repeat: 'weekly', repeatDays: [1, 3, 5], due: '2026-10-21',
    })
  })
  it('每周一三五打卡（连写）也能认', () => {
    expect(parse('每周一三五打卡')).toMatchObject({
      title: '打卡', repeat: 'weekly', repeatDays: [1, 3, 5],
    })
  })
  it('每月15号 交房租：本月已过，落到 11-15', () => {
    expect(parse('每月15号 交房租')).toMatchObject({
      title: '交房租', repeat: 'monthly', repeatMonthDay: 15, due: '2026-11-15',
    })
  })
  it('每月十五号（中文数字）', () => {
    expect(parse('每月十五号 交房租')).toMatchObject({
      title: '交房租', repeat: 'monthly', repeatMonthDay: 15,
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
  it('每天8点 喝水：打卡时间不按此刻往后挪', () => {
    expect(parse('每天8点 喝水')).toMatchObject({ title: '喝水', repeat: 'daily', dueTime: '08:00' })
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

describe('时间：没写时段词时取「今天之后最近的那个点」', () => {
  it('上午 10:30 说「3点半」→ 今天 15:30', () => {
    expect(parse('3点半复诊')).toMatchObject({ title: '复诊', dueTime: '15:30', due: '2026-10-20' })
  })
  it('上午 10:30 说「2点」→ 今天 14:00', () => {
    expect(parse('2点 开会')).toMatchObject({ title: '开会', dueTime: '14:00', due: '2026-10-20' })
  })
  it('上午 10:30 说「7点」→ 今天 19:00（20 点还没到）', () => {
    expect(parse('7点 跑步')).toMatchObject({ title: '跑步', dueTime: '19:00', due: '2026-10-20' })
  })
  it('晚上 19:53 说「6点 起床」→ 明天 06:00，而不是 18:00', () => {
    expect(parseAt(19, 53, '6点 起床')).toMatchObject({ title: '起床', dueTime: '06:00', due: '2026-10-21' })
  })
  it('晚上 19:53 说「7点 晚饭」→ 明天 07:00，而不是今天', () => {
    expect(parseAt(19, 53, '7点 晚饭')).toMatchObject({ title: '晚饭', dueTime: '07:00', due: '2026-10-21' })
  })
  it('3点开会（连写）→ 15:00', () => {
    expect(parse('3点开会')).toMatchObject({ title: '开会', dueTime: '15:00' })
  })
  it('12点 → 中午 12:00', () => {
    expect(parse('12点 吃饭')).toMatchObject({ title: '吃饭', dueTime: '12:00' })
  })
})

describe('时间：时段词', () => {
  it('凌晨2点 看球 → 02:00（今天已过 → 明天）', () => {
    expect(parse('凌晨2点 看球')).toMatchObject({ title: '看球', dueTime: '02:00', due: '2026-10-21' })
  })
  it('上午9点 站会 → 09:00', () => {
    expect(parse('上午9点 站会')).toMatchObject({ title: '站会', dueTime: '09:00' })
  })
  it('下午3点 评审 → 15:00', () => {
    expect(parse('下午3点 评审')).toMatchObject({ title: '评审', dueTime: '15:00', due: '2026-10-20' })
  })
  it('晚上8点 跑步 → 20:00', () => {
    expect(parse('晚上8点 跑步')).toMatchObject({ title: '跑步', dueTime: '20:00', due: '2026-10-20' })
  })
  it('下午三点 复盘 → 15:00', () => {
    expect(parse('下午三点 复盘')).toMatchObject({ title: '复盘', dueTime: '15:00' })
  })
  it('中午1点 吃饭 → 13:00', () => {
    expect(parse('中午1点 吃饭')).toMatchObject({ title: '吃饭', dueTime: '13:00' })
  })
  it('中午12点 → 12:00', () => {
    expect(parse('中午12点 吃饭')).toMatchObject({ title: '吃饭', dueTime: '12:00' })
  })
  it('今晚9点 加班 → 21:00，标题不留「今晚」', () => {
    expect(parse('今晚9点 加班')).toMatchObject({ title: '加班', dueTime: '21:00', due: '2026-10-20' })
  })
  it('今天晚上9点（带「今天」）也一样', () => {
    expect(parse('今天晚上9点 加班')).toMatchObject({ title: '加班', dueTime: '21:00', due: '2026-10-20' })
  })
  it('明晚8点 → 明天 20:00', () => {
    expect(parse('明晚8点 聚会')).toMatchObject({ title: '聚会', dueTime: '20:00', due: '2026-10-21' })
  })
  it('晚上12点 → 次日 00:00', () => {
    expect(parse('晚上12点 跨年')).toMatchObject({ title: '跨年', dueTime: '00:00', due: '2026-10-21' })
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

describe('预览', () => {
  it('只写时间也要显示出来（今天 15:30）', () => {
    expect(parseSummary(parse('3点半复诊'))).toContain('今天 15:30')
  })
  it('跨到明天的时间显示「明天」', () => {
    expect(parseSummary(parseAt(19, 53, '6点 起床'))).toContain('明天 06:00')
  })
  it('重复规则显示成中文周期', () => {
    expect(parseSummary(parse('每周一三五 健身'))).toContain('每周一三五')
    expect(parseSummary(parse('每月15号 交房租'))).toContain('每月15号')
  })
  it('清单一栏：只写时间时归到「今日」', () => {
    expect(inferTier(parse('3点半复诊'), 'anytime')).toBe('today')
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

describe('边界', () => {
  it('每月31号：本月 10-31 还没到就用本月', () => {
    expect(parse('每月31号 对账')).toMatchObject({ repeat: 'monthly', repeatMonthDay: 31, due: '2026-10-31' })
  })
  it('下个月31号：11 月没有 31 号 → 收敛到 11-30', () => {
    expect(parse('下个月31号 对账')).toMatchObject({ title: '对账', due: '2026-11-30' })
  })
  it('中午1点吃饭（连写）→ 13:00', () => {
    expect(parse('中午1点吃饭')).toMatchObject({ title: '吃饭', dueTime: '13:00' })
  })
  it('晚上11点 → 23:00，不跨天', () => {
    expect(parse('晚上11点 收尾')).toMatchObject({ title: '收尾', dueTime: '23:00', due: '2026-10-20' })
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

/* ---------------- v3.1：从标题里尽可能多挖信息 ---------------- */

describe('打卡次数', () => {
  it('每天 喝水 8 次 → 次数 8', () => {
    expect(parse('每天 喝水 8 次')).toMatchObject({ title: '喝水', repeat: 'daily', repeatCount: 8 })
  })
  it('连写「每天喝水8次」也认', () => {
    expect(parse('每天喝水8次')).toMatchObject({ title: '喝水', repeat: 'daily', repeatCount: 8 })
  })
  it('中文数字「3 遍」', () => {
    expect(parse('每天背单词3遍')).toMatchObject({ repeatCount: 3 })
  })
  it('只有次数没有周期 → 猜成每天打卡', () => {
    expect(parse('深蹲20次')).toMatchObject({ repeat: 'daily', repeatCount: 20, guesses: ['每天'] })
  })
  it('「第3次」「这次」「每次」不是次数', () => {
    expect(parse('第3次 提交表单').repeatCount).toBeUndefined()
    expect(parse('这次 复习').repeatCount).toBeUndefined()
    expect(parse('每次 都要记').repeatCount).toBeUndefined()
  })
})

describe('多个打卡时间点', () => {
  it('每天8点、21点 喝水 → 两个时间点', () => {
    const p = parse('每天8点、21点 喝水')
    expect(p.dueTime).toBe('08:00')
    expect(p.repeatTimes).toEqual(['08:00', '21:00'])
    expect(p.title).toBe('喝水')
    expect(p.title).not.toContain('、')
  })
  it('非重复任务只取第一个时间', () => {
    const p = parse('明天 8点、21点 巡检')
    expect(p.dueTime).toBe('08:00')
    expect(p.repeatTimes).toBeUndefined()
  })
})

describe('预计用时', () => {
  it('读30分钟书 → 30 分钟', () => {
    expect(parse('读30分钟书')).toMatchObject({ estimateMinutes: 30, title: '读书' })
  })
  it('练琴一个半小时 → 90 分钟', () => {
    expect(parse('练琴一个半小时')).toMatchObject({ estimateMinutes: 90 })
  })
  it('半小时后 提醒我 → 相对时间，不是时长', () => {
    const p = parse('半小时后 提醒我')
    expect(p.estimateMinutes).toBeUndefined()
    expect(p.dueTime).toBe('11:00')
    expect(p.due).toBe('2026-10-20')
    expect(p.title).toBe('提醒我')
  })
})

describe('只写时段 → 猜一个默认时刻', () => {
  it('明天上午 交材料 → 明天 09:00', () => {
    const p = parse('明天上午 交材料')
    expect(p).toMatchObject({ title: '交材料', due: '2026-10-21', dueTime: '09:00' })
    expect(p.guesses).toContain('上午≈09:00')
  })
  it('晚上 复盘 → 20:00', () => {
    expect(parse('晚上 复盘')).toMatchObject({ dueTime: '20:00' })
  })
})

describe('关键词 → 优先级（只是猜，不改标题）', () => {
  it('紧急 → P0', () => {
    expect(parse('紧急 交报告')).toMatchObject({ priority: 0 })
  })
  it('务必 → P1', () => {
    expect(parse('务必 回复邮件')).toMatchObject({ priority: 1 })
  })
  it('有空 → P3', () => {
    expect(parse('有空 整理书架')).toMatchObject({ priority: 3 })
  })
  it('显式 P2 不被关键词覆盖', () => {
    expect(parse('紧急 交报告 P2')).toMatchObject({ priority: 2 })
  })
})

describe('周区间', () => {
  it('周一到周五 → 工作日', () => {
    expect(parse('周一到周五 跑步')).toMatchObject({ repeat: 'weekdays', title: '跑步' })
  })
  it('周六到周日 → 每周六日', () => {
    expect(parse('周六到周日 兼职')).toMatchObject({ repeat: 'weekly', repeatDays: [0, 6] })
  })
})
