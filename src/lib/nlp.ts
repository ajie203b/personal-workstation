import { addDaysStr, CN_NUM, fmtDue, nextWeekday, parseDateStr, todayStr, toDateStr } from './date'
import { repeatLabel, type RepeatKind } from './repeat'

export type Priority = 0 | 1 | 2 | 3

export interface ParsedTask {
  title: string
  due?: string // YYYY-MM-DD
  dueTime?: string // HH:mm
  priority?: Priority
  tags: string[]
  repeat?: RepeatKind
  /** 每周指定几天；「每周一三五」→ [1,3,5] */
  repeatDays?: number[]
  /** 每月指定几号；「每月15号」→ 15 */
  repeatMonthDay?: number
}

interface Token {
  re: RegExp
  /** 命中后消费匹配文本，写入 parsed */
  handle: (m: RegExpMatchArray, p: ParsedTask) => void
  /** 歧义写法在消费前先过一次裁决（返回 false 则跳过、保留原文） */
  guard?: (m: RegExpMatchArray) => boolean
}

/** 时段词：决定同一个「9点」是上午还是晚上 */
const PERIOD_ALT = '凌晨|半夜|清晨|早晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚|今早|明早|夜里|夜间'
const HOUR_ALT = '二十[一二三四五六七八九]?|2[0-3]|[01]?\\d|十[一二三四五六七八九]?|一|两|二|三|四|五|六|七|八|九'

/** 中文优先的自然语言解析：「明天14:00 交报告 P1 #工作」 */
export function parseQuickAdd(raw: string): ParsedTask {
  const p: ParsedTask = { title: '', tags: [] }
  let s = ` ${raw.trim()} `
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  /** 只写时间不写日期时，解析结果落到今天还是明天 */
  let dayOffset = 0
  let timeFromClock = false

  // —— 标签 #xxx ——
  s = s.replace(/\s#([^#\s]+)/g, (_, tag: string) => {
    p.tags.push(tag)
    return ' '
  })

  // —— 优先级 P0–P3（含全角；支持「报告P1」「P1交报告」两种连写）——
  s = s.replace(/([^\s#@pPｐＰ0-9a-zA-Z])([pPｐＰ][0-3０-３])(?=\s|$)/g, '$1 $2')
  // 行首 / 空白后的 P1 后面可以直接接中文；接英文时不认（p2p 不是优先级）
  s = s.replace(/(^|\s)([pPｐＰ][0-3０-３])(?=\s|$|[\u4e00-\u9fff])/g, '$1 $2 ')
  s = s.replace(/\s[pｐPＰ]([0-3０-３])(?=\s)/g, (_, d: string) => {
    p.priority = Number(d) as Priority
    return ' '
  })

  // 后置日期：标题后面的日期词也能识别
  s = s.replace(/(开会|提醒|交|完成|处理)\s*(明天|今日|明天|后天)/g, '$1 $2 ')

  // —— 「周五前 / 下周三前」的截止词：先把「前」与后文分开，
  //    否则下一步会把它当成普通连写拆成「周五 前交作业」，标题里留下一个孤零零的「前」
  s = s.replace(/((?:下下周|下周|这周)?(?:周|星期|礼拜)[一二三四五六日天])(?:之前|以前|前)(?=[^\s])/g, '$1前 ')

  // —— 归一化（两趟，防贪心回溯拆散数字）：
  // ① 中文日期/重复词与任何非空白字符连写时补空格（含数字，如「明天14:00」「每天喝水」）
  //    · 周几后面紧跟「前」时不拆（交给日期词整体匹配）
  //    · 裸「周X」只在词首（前面是空格）才拆，否则「每周一三五」会被它从中间切开
  //    · 多天写法整体保留：「每周一三五」不拆成「每周一 三五」
  const DATE_GLUE = [
    '今天|今日|明天|明日|后天|大后天',
    '[0-9一二两三四五六七八九十]+天[后後]',
    '下下周[一二三四五六日天](?!前)',
    '下周[一二三四五六日天](?!前)',
    '这(?:周|星期|礼拜)[一二三四五六日天]+(?![\\s一二三四五六日天前])',
    '每(?:周|星期|礼拜)[一二三四五六日天]+(?![\\s一二三四五六日天前])',
    '(?:周|星期|礼拜)[一二三四五六日天](?!前)',
    '每(?:个)?月[0-9一二三四五六七八九十]{1,3}[日号]',
    '下(?:个)?月[0-9一二三四五六七八九十]{1,3}[日号]',
    '每天|每日',
    '每周(?![一二三四五六日天])',
    '工作日',
  ].join('|')
  s = s.replace(new RegExp(`(^|\\s)(${DATE_GLUE})(?=[^\\s])`, 'g'), (_m, sp: string, tok: string) => `${sp}${tok} `)
  // ② 时间词仅在紧贴汉字时补空格（「3点半开会」「3点开会」「14:00开会」）；
  //    紧跟「第」的不算时间（「读第3点笔记」）
  s = s.replace(
    new RegExp(`(^|[^第])([0-9一二两三四五六七八九十]+点(?:半|[0-5]?\\d分?)?|[0-9]{1,2}[:：][0-5][0-9])(?=[^\\s\\d])`, 'g'),
    '$1$2 ',
  )
  // ③ 数字型日期同上（「10月8日交房租」），后面排除数字避免拆散 2026-10-15
  s = s.replace(
    /([0-9]{1,4}[-/.年][0-9]{1,2}[-/.月][0-9]{1,2}日?|[0-9]{1,2}月[0-9]{1,2}[日号])(?=[^\s\d])/g,
    '$1 ',
  )

  // —— 重复：每天 / 每周（含「每周一三五」）/ 工作日 / 每月15号 ——
  s = s.replace(/\s(每天|每日)(?=\s)/g, () => {
    p.repeat = 'daily'
    return ' '
  })
  s = s.replace(/\s每(?:周|星期|礼拜)([一二三四五六日天]{1,6})(?=\s)/g, (_m, wd: string) => {
    const days = [...new Set(wd.split('').map(cnWeekday))].sort((a, b) => a - b)
    p.repeat = 'weekly'
    p.repeatDays = days
    if (!p.due) p.due = nearestWeekdayDate(days)
    return ' '
  })
  s = s.replace(/\s每(?:周|星期|礼拜)(?=\s)/g, () => {
    p.repeat = 'weekly'
    return ' '
  })
  s = s.replace(/\s工作日(?=\s)/g, () => {
    p.repeat = 'weekdays'
    return ' '
  })
  s = s.replace(/\s每(?:个)?月([0-9一二三四五六七八九十]{1,3})[日号](?=\s)/g, (_m, d: string) => {
    const day = cnToNumber(d)
    if (day != null && day >= 1 && day <= 31) {
      p.repeat = 'monthly'
      p.repeatMonthDay = day
      if (!p.due) p.due = nextMonthDay(day)
    }
    return ' '
  })

  // —— 时间：14:00 / 14点 / 下午3点(半) / 中午1点 / 今晚9点 ——
  // 前导空格与时段词前缀都可选；右侧要求是边界（归一化已把连写的「3点开会」拆开），
  // 这样「第3点笔记」「7-11」这类正文不会被误当成时间。
  const timeRe = new RegExp(`\\s?(${PERIOD_ALT})?\\s?(${HOUR_ALT})点(半|[0-5]?\\d分?)?(?=\\s|[，。！？、,.!?;；]|$)`)
  const tm = s.match(timeRe)
  // 「第3点」是序号不是时间（归一化那边也放过它，这里再兜一次）
  const beforeTime = tm ? s.slice(0, tm.index).trimEnd() : ''
  if (tm && !beforeTime.endsWith('第')) {
    const h0 = parseHourWord(tm[2])
    const rawMin = tm[3]
    const mm = rawMin == null ? 0 : rawMin === '半' ? 30 : Number(rawMin.replace('分', ''))
    const clock = resolveClock(h0, mm, tm[1], nowMin, Boolean(p.repeat))
    p.dueTime = `${pad2(clock.hour)}:${pad2(mm)}`
    dayOffset = clock.dayOffset
    timeFromClock = true
    s = s.replace(timeRe, ' ')
  }
  const hmRe = /\s([01]?\d|2[0-3])[:：]([0-5]\d)(?=\s)/
  const hm = s.match(hmRe)
  if (hm) {
    p.dueTime = `${pad2(Number(hm[1]))}:${hm[2]}`
    s = s.replace(hmRe, ' ')
  }

  // —— 日期 ——
  // 截止词「前 / 之前 / 以前」直接跟在日期词后时一并消费（「周五前」「下周三前」）
  const DEADLINE = '(?:之前|以前|前)?'
  const dateTokens: Token[] = [
    { re: /\s(今天|今日)(?=\s)/, handle: (_m, q) => { q.due = todayStr() } },
    { re: /\s(明天|明日)(?=\s)/, handle: (_m, q) => { q.due = addDaysStr(1) } },
    { re: /\s(后天)(?=\s)/, handle: (_m, q) => { q.due = addDaysStr(2) } },
    { re: /\s(大后天)(?=\s)/, handle: (_m, q) => { q.due = addDaysStr(3) } },
    {
      re: /\s([0-9一二两三四五六七八九十]+)天[后後](?=\s)/,
      handle: (m, q) => {
        const n = cnToNumber(m[1])
        if (n != null) q.due = addDaysStr(n)
      },
    },
    {
      re: new RegExp(`\\s下下周([一二三四五六日天])${DEADLINE}(?=\\s)`),
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[1]), 2) },
    },
    {
      re: new RegExp(`\\s下周([一二三四五六日天])${DEADLINE}(?=\\s)`),
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[1]), 1) },
    },
    {
      // 「这周五」：这周里那一天；已经过去的就顺延到下周同一天，不生成过去日期
      re: new RegExp(`\\s这(?:周|星期|礼拜)([一二三四五六日天])${DEADLINE}(?=\\s)`),
      handle: (m, q) => { q.due = thisWeekday(cnWeekday(m[1])) },
    },
    {
      re: new RegExp(`\\s(?:周|星期|礼拜)([一二三四五六日天])${DEADLINE}(?=\\s)`),
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[1]), 0) },
    },
    {
      // 「下个月1号 / 下月1号」
      re: /\s下(?:个)?月([0-9一二三四五六七八九十]{1,3})[日号](?=\s)/,
      handle: (m, q) => {
        const day = cnToNumber(m[1])
        if (day == null || day < 1 || day > 31) return
        q.due = monthDayIn(new Date(), 1, day)
      },
    },
    {
      re: /\s(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?=\s)/,
      handle: (m, q) => { q.due = `${m[1]}-${pad(m[2])}-${pad(m[3])}` },
    },
    {
      re: /\s(\d{1,2})月(\d{1,2})[日号](?=\s)/,
      handle: (m, q) => {
        const year = new Date().getFullYear()
        const due = `${year}-${pad(m[1])}-${pad(m[2])}`
        q.due = due < todayStr() ? `${year + 1}-${pad(m[1])}-${pad(m[2])}` : due
      },
    },
    {
      re: /\s(\d{1,2})[-/](\d{1,2})(?=\s)/,
      // 两边都不超过 12 时是歧义写法（「7-11 买咖啡」），不当日期；
      // 「12-25」「3-15」这种能唯一确定才认。要写月份请用「7月11日」。
      guard: (m) => Number(m[1]) > 12 || Number(m[2]) > 12,
      handle: (m, q) => {
        const year = new Date().getFullYear()
        const due = `${year}-${pad(m[1])}-${pad(m[2])}`
        q.due = due < todayStr() ? `${year + 1}-${pad(m[1])}-${pad(m[2])}` : due
      },
    },
  ]
  for (const t of dateTokens) {
    const m = s.match(t.re)
    if (!m) continue
    if (t.guard && !t.guard(m)) continue
    t.handle(m, p)
    s = s.replace(t.re, ' ')
    break // 只取第一个命中的日期
  }

  // 只写了时间、没写日期：把「今天之后最近的那个点」落成具体日期，
  // 否则预览里只剩一个光秃秃的 15:30，用户看不出被识别成今天还是明天
  if (p.dueTime && !p.due && timeFromClock) p.due = addDaysStr(dayOffset)

  p.title = s.replace(/\s+/g, ' ').trim()
  if (!p.title) p.title = raw.trim()
  return p
}

/* ---------------- 时间 ---------------- */

interface ClockResult {
  hour: number
  dayOffset: number
}

/**
 * 把「几点 + 时段词」落成 24 小时制，并判断该算今天还是明天。
 *
 * 没写时段词时不再按「1–6 点算下午、7 点以后算上午」硬猜——那套规则在
 * 「6点 起床」（→18:00）和「7点 晚饭」（→07:00）两头都会错。
 * 现在取「今天之后最近的那个这个点」：19:53 说「6点」就是明天 06:00，
 * 10:30 说「3点半」就是今天 15:30。
 */
function resolveClock(h0: number, mm: number, period: string | undefined, nowMin: number, isRepeat: boolean): ClockResult {
  const passed = (h: number) => h * 60 + mm <= nowMin
  let hour = h0
  let dayOffset = 0
  let dayHint: 'today' | 'tomorrow' | undefined
  let crossDay = false

  if (period) {
    switch (period) {
      case '凌晨':
      case '半夜':
      case '夜里':
      case '夜间':
        // 凌晨12点 = 00:00（第二天）
        if (h0 === 12) { hour = 0; crossDay = true } else hour = h0
        break
      case '晚上':
      case '今晚':
      case '明晚':
        if (period === '明晚') dayHint = 'tomorrow'
        if (h0 === 12) { hour = 0; crossDay = true } else hour = h0 < 12 ? h0 + 12 : h0
        break
      case '中午':
        // 中午1点 = 13:00，中午12点 = 12:00
        hour = h0 === 12 ? 12 : h0 <= 6 ? h0 + 12 : h0
        break
      case '下午':
      case '傍晚':
        hour = h0 === 12 ? 12 : h0 < 12 ? h0 + 12 : h0
        break
      default:
        // 清晨 / 早晨 / 早上 / 上午 / 今早 / 明早：按字面小时
        if (period === '明早') dayHint = 'tomorrow'
        else if (period === '今早') dayHint = 'today'
        hour = h0
    }
  }

  if (crossDay) {
    // 晚上12点 / 凌晨12点 = 次日 00:00，不能再按「今天过没过」去算
    dayOffset = (dayHint === 'tomorrow' ? 1 : 0) + 1
  } else if (dayHint === 'tomorrow') {
    dayOffset = 1
  } else if (dayHint === 'today') {
    dayOffset = 0
  } else if (isRepeat) {
    // 打卡任务的时间是「每天几点」，不该按此刻往后挪（否则「每天8点」会被推到 20:00）
    dayOffset = 0
  } else if (period) {
    // 写了时段词就不用猜时段，只判断这个点今天过没过
    dayOffset = passed(hour) ? 1 : 0
  } else {
    const cands = hour > 12 ? [hour] : hour === 12 ? [12] : [hour, hour + 12]
    const future = cands.filter((c) => !passed(c))
    if (future.length) {
      hour = future[0]
      dayOffset = 0
    } else {
      hour = cands[0]
      dayOffset = 1
    }
  }

  return { hour, dayOffset }
}

function parseHourWord(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw.startsWith('二十')) return raw === '二十' ? 20 : 20 + (CN_NUM[raw.slice(2)] ?? 0)
  if (raw === '十') return 10
  if (raw.startsWith('十')) return 10 + (CN_NUM[raw[1]] ?? 0)
  return CN_NUM[raw] ?? 0
}

/* ---------------- 日期 ---------------- */

function cnWeekday(ch: string): number {
  const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
  return map[ch] ?? 1
}

function pad(n: string): string {
  return String(Number(n)).padStart(2, '0')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 「十五」→15；「3」→3 */
function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] ?? 0)
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    return (CN_NUM[a] ?? 0) * 10 + (b ? (CN_NUM[b] ?? 0) : 0)
  }
  return CN_NUM[s] ?? null
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

/** 指定年月的某日号；日号超过当月天数时收敛到月末 */
function monthDayIn(from: Date, monthsAhead: number, day: number): string {
  const total = from.getMonth() + monthsAhead
  const y = from.getFullYear() + Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12
  return toDateStr(new Date(y, m, Math.min(day, daysInMonth(y, m))))
}

/** 本月还没过就本月，过了就下月：「每月15号」的含义 */
function nextMonthDay(day: number): string {
  const cand = monthDayIn(new Date(), 0, day)
  return cand >= todayStr() ? cand : monthDayIn(new Date(), 1, day)
}

/** 「这周五」：本周那一天；已经过去了就顺延到下同一天，不生成过去日期 */
function thisWeekday(target: number): string {
  const d = nextWeekday(target, 0)
  return d < todayStr() ? addDaysStr(7, parseDateStr(d)) : d
}

/** 「每周一三五」的首次截止：今天起第一个命中集合的日子 */
function nearestWeekdayDate(days: number[]): string {
  for (let i = 0; i < 8; i++) {
    const ds = addDaysStr(i)
    if (days.includes(parseDateStr(ds).getDay())) return ds
  }
  return addDaysStr(0)
}

/* ---------------- 对外 ---------------- */

/** 依据解析结果推断四清单归属（Things 3 时间语义） */
export function inferTier(parsed: ParsedTask, fallback: 'today' | 'upcoming' | 'anytime' | 'someday') {
  if (parsed.due) {
    return parsed.due <= todayStr() ? 'today' : 'upcoming'
  }
  if (parsed.repeat === 'daily') return 'today'
  return fallback
}

/** 供预览展示 */
export function parseSummary(parsed: ParsedTask): string[] {
  const out: string[] = []
  if (parsed.due) {
    out.push(fmtDue(parsed.due, parsed.dueTime ?? null).text)
  } else if (parsed.dueTime) {
    // 只有时间没有日期时也要显示出来，别让预览空着
    out.push(parsed.dueTime)
  }
  if (parsed.repeat) {
    out.push(repeatLabel(parsed.repeat, { days: parsed.repeatDays, monthDay: parsed.repeatMonthDay }))
  }
  if (parsed.priority != null) out.push(`P${parsed.priority}`)
  for (const t of parsed.tags) out.push(`#${t}`)
  return out
}
