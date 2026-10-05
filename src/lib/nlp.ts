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

  // —— 优先级 P0–P3（含全角；支持「报告P1」连写）——
  s = s.replace(/([^\s#@pP0-9a-zA-Z])([pP][0-3０-３])(?=\s|$)/g, '$1 $2')
  s = s.replace(/\s[pｐP]([0-3０-３])(?=\s)/g, (_, d: string) => {
    p.priority = Number(d) as Priority
    return ' '
  })

  // 后置日期：标题后面的日期词也能识别
  s = s.replace(/(开会|提醒|交|完成|处理)\s*(明天|今日|明天|后天)/g, '$1 $2 ')

  // —— 归一化（两趟，防贪心回溯拆散数字）：
  // ① 中文日期/重复词与任何非空白字符连写时补空格（含数字，如「明天14:00」「每天喝水」）
  s = s.replace(
    /(今天|今日|明天|明日|后天|大后天|[0-9一二两三四五六七八九十]+天[后後]|下下周[一二三四五六日天]|下周[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|每天|每日|每周|工作日)(?=[^\s])/g,
    '$1 ',
  )
  // ② 数字型时间/日期仅在紧贴汉字时补空格（「3点半开会」「10月8日交房租」「14:00开会」），
  //    后瞻排除数字，避免「2026-10-15」「3点半 复诊」被错误拆散
  s = s.replace(
    /([0-9]{1,4}[-/.年][0-9]{1,2}[-/.月][0-9]{1,2}日?|[0-9]{1,2}月[0-9]{1,2}[日号]|[0-9一二两三四五六七八九十]+点半|[0-9一二两三四五六七八九十]+点[0-5]?[0-9]分?|[0-9]{1,2}[:：][0-5][0-9])(?=[^\s\d])/g,
    '$1 ',
  )

  // —— 重复：每天 / 每周 / 工作日 ——
  s = s.replace(/\s(每天|每日)(?=\s)/g, () => {
    p.repeat = 'daily'
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
  // 前导空格与时段词前缀都可选：「下午3点」「今天 下午3点」「3点半」均可命中
  const timeRe =
    /\s?(上午|早上|中午|下午|傍晚|晚上)?\s?(二十[一二三四五六七八九]?|[01]?\d|2[0-3]|十[一二三四五六七八九]?|一|两|二|三|四|五|六|七|八|九)点(半|[0-5]?\d分?)?/
  const tm = s.match(timeRe)
  if (tm) {
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
    if (tm[1] && (tm[1] === '下午' || tm[1] === '晚上' || tm[1] === '傍晚') && h < 12) h += 12
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
      re: /\s下下周[一二三四五六日天](?=\s)/,
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[0].slice(-1)), 2) },
    },
    {
      re: /\s下周[一二三四五六日天](?=\s)/,
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[0].slice(-1)), 1) },
    },
    {
      re: /\s(周|星期|礼拜)[一二三四五六日天](?=\s)/,
      handle: (m, q) => { q.due = nextWeekday(cnWeekday(m[0].slice(-1)), 0) },
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
      handle: (m, q) => {
        const year = new Date().getFullYear()
        const due = `${year}-${pad(m[1])}-${pad(m[2])}`
        q.due = due < todayStr() ? `${year + 1}-${pad(m[1])}-${pad(m[2])}` : due
      },
    },
  ]
  for (const t of dateTokens) {
    const m = s.match(t.re)
    if (m) {
      t.handle(m, p)
      s = s.replace(t.re, ' ')
      break // 只取第一个命中的日期
    }
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
