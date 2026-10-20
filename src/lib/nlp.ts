import { addDaysStr, CN_NUM, nextWeekday, todayStr, toDateStr } from './date'

export type Priority = 0 | 1 | 2 | 3

export interface ParsedTask {
  title: string
  due?: string // YYYY-MM-DD
  dueTime?: string // HH:mm
  priority?: Priority
  tags: string[]
  repeat?: 'daily' | 'weekly' | 'weekdays'
}

interface Token {
  re: RegExp
  /** 命中后消费匹配文本，写入 parsed */
  handle: (m: RegExpMatchArray, p: ParsedTask) => void
  /** 歧义写法在消费前先过一次裁决（返回 false 则跳过、保留原文） */
  guard?: (m: RegExpMatchArray) => boolean
}

/** 中文优先的自然语言解析：「明天14:00 交报告 P1 #工作」 */
export function parseQuickAdd(raw: string): ParsedTask {
  const p: ParsedTask = { title: '', tags: [] }
  let s = ` ${raw.trim()} `

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
  s = s.replace(/((?:下下周|下周)?(?:周|星期|礼拜)[一二三四五六日天])(?:之前|以前|前)(?=[^\s])/g, '$1前 ')

  // —— 归一化（两趟，防贪心回溯拆散数字）：
  // ① 中文日期/重复词与任何非空白字符连写时补空格（含数字，如「明天14:00」「每天喝水」）
  //    · 周几后面紧跟「前」时不拆（交给日期词整体匹配）
  //    · 裸「每周」后面紧跟周几时不拆（否则「每周三 打球」会被拆成「每周 三」）
  s = s.replace(
    /(今天|今日|明天|明日|后天|大后天|[0-9一二两三四五六七八九十]+天[后後]|下下周[一二三四五六日天](?!前)|下周[一二三四五六日天](?!前)|每周[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天](?!前)|每天|每日|每周(?![一二三四五六日天])|工作日)(?=[^\s])/g,
    '$1 ',
  )
  // ② 时间词仅在紧贴汉字时补空格（「3点半开会」「3点开会」「14:00开会」）；
  //    紧跟「第」的不算时间（「读第3点笔记」）
  s = s.replace(
    /(^|[^第])([0-9一二两三四五六七八九十]+点(?:半|[0-5]?\d分?)?|[0-9]{1,2}[:：][0-5][0-9])(?=[^\s\d])/g,
    '$1$2 ',
  )
  // ③ 数字型日期同上（「10月8日交房租」），后面排除数字避免拆散 2026-10-15
  s = s.replace(
    /([0-9]{1,4}[-/.年][0-9]{1,2}[-/.月][0-9]{1,2}日?|[0-9]{1,2}月[0-9]{1,2}[日号])(?=[^\s\d])/g,
    '$1 ',
  )

  // —— 重复：每天 / 每周（含「每周三」式周几）/ 工作日 ——
  s = s.replace(/\s(每天|每日)(?=\s)/g, () => {
    p.repeat = 'daily'
    return ' '
  })
  s = s.replace(/\s每周([一二三四五六日天])(?=\s)/g, (_m, wd: string) => {
    p.repeat = 'weekly'
    if (!p.due) p.due = nextWeekday(cnWeekday(wd), 0)
    return ' '
  })
  s = s.replace(/\s每周(?=\s)/g, () => {
    p.repeat = 'weekly'
    return ' '
  })
  s = s.replace(/\s工作日(?=\s)/g, () => {
    p.repeat = 'weekdays'
    return ' '
  })

  // —— 时间：14:00 / 14点 / 下午3点(半) / 中午12点 / 下午三点 ——
  // 前导空格与时段词前缀都可选：「下午3点」「今天 下午3点」「3点半」均可命中；
  // 右侧要求是边界（归一化已把连写的「3点开会」拆成「3点 开会」），
  // 这样「第3点笔记」「7-11」这类正文不会被误当成时间。
  const timeRe =
    /\s?(上午|早上|凌晨|中午|下午|傍晚|晚上)?\s?(二十[一二三四五六七八九]?|[01]?\d|2[0-3]|十[一二三四五六七八九]?|一|两|二|三|四|五|六|七|八|九)点(半|[0-5]?\d分?)?(?=\s|[，。！？、,.!?;；]|$)/
  const tm = s.match(timeRe)
  // 「第3点」是序号不是时间（归一化那边也放过它，这里再兜一次）
  const beforeTime = tm ? s.slice(0, tm.index).trimEnd() : ''
  if (tm && !beforeTime.endsWith('第')) {
    const rawHour = tm[2]
    let h: number
    if (/^\d+$/.test(rawHour)) {
      h = Number(rawHour)
    } else if (rawHour.startsWith('二十')) {
      h = rawHour === '二十' ? 20 : 20 + (CN_NUM[rawHour.slice(2)] ?? 0)
    } else if (rawHour === '十' || rawHour === '十一' || rawHour === '十二') {
      h = rawHour === '十' ? 10 : rawHour === '十一' ? 11 : 12
    } else {
      h = CN_NUM[rawHour] ?? 0
    }
    const period = tm[1]
    if (period && (period === '下午' || period === '晚上' || period === '傍晚') && h < 12) {
      h += 12
    } else if (!period && h >= 1 && h <= 6) {
      // 没写时段时 1–6 点按下午算（「3点半复诊」= 15:30）；凌晨/早上要显式写
      h += 12
    }
    const rawMin = tm[3]
    const mm = rawMin == null || rawMin === '半' ? (rawMin === '半' ? 30 : 0) : Number(rawMin.replace('分', ''))
    p.dueTime = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    s = s.replace(timeRe, ' ')
  }
  const hmRe = /\s([01]?\d|2[0-3])[:：]([0-5]\d)(?=\s)/
  const hm = s.match(hmRe)
  if (hm) {
    p.dueTime = `${String(Number(hm[1])).padStart(2, '0')}:${hm[2]}`
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
        const n = /^\d+$/.test(m[1]) ? Number(m[1]) : CN_NUM[m[1]]
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
      re: new RegExp(`\\s(?:周|星期|礼拜)([一二三四五六日天])${DEADLINE}(?=\\s)`),
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[1]), 0) },
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

  p.title = s.replace(/\s+/g, ' ').trim()
  if (!p.title) p.title = raw.trim()
  return p
}

function cnWeekday(ch: string): number {
  const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
  return map[ch] ?? 1
}

function pad(n: string): string {
  return String(Number(n)).padStart(2, '0')
}

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
    const d = parsed.due === todayStr() ? '今天' : parsed.due === addDaysStr(1) ? '明天' : toDateStr(new Date(parsed.due))
    out.push(parsed.dueTime ? `${d} ${parsed.dueTime}` : d)
  }
  if (parsed.repeat) out.push({ daily: '每天', weekly: '每周', weekdays: '工作日' }[parsed.repeat])
  if (parsed.priority != null) out.push(`P${parsed.priority}`)
  for (const t of parsed.tags) out.push(`#${t}`)
  return out
}
