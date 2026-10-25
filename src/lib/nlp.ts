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
  /** 打卡次数：「喝水8次」→ 8；「每天3次」→ 3 */
  repeatCount?: number
  /** 打卡时间点（可多个）：「早8点晚9点」→ ['08:00','21:00'] */
  repeatTimes?: string[]
  /** 预计用时（分钟）：「30分钟」「一个半小时」→ 30 / 90 */
  estimateMinutes?: number
  /** 从「明天开始」「现在开始」推出来的计划开始时间 */
  startAt?: number
  /** 推测出来的结论（预览里标注「猜」，让用户知道哪些是想当然） */
  guesses: string[]
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
const NUMBER_WORD = '[0-9零〇一二两三四五六七八九十]+'

/** 只说了时段没说几点时的默认时刻：照中国人的日常习惯取整点 */
const PERIOD_HOUR: Record<string, number> = {
  凌晨: 5, 半夜: 0, 夜里: 22, 夜间: 22,
  清晨: 6, 早晨: 7, 早上: 8, 上午: 9, 今早: 8, 明早: 8,
  中午: 12, 下午: 15, 傍晚: 18, 晚上: 20, 今晚: 20, 明晚: 20,
}

/** 中文优先的自然语言解析：「明天14:00 交报告 P1 #工作」 */
export function parseQuickAdd(raw: string): ParsedTask {
  const p: ParsedTask = { title: '', tags: [], guesses: [] }
  let s = ` ${raw.trim().replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10))} `
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
    p.priority = Number(d.replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10))) as Priority
    return ' '
  })

  // 后置日期：标题后面的日期词也能识别
  s = s.replace(/(开会|提醒|交|完成|处理)\s*(明天|今日|明天|后天)/g, '$1 $2 ')

  // —— 多信息抽取（v3.1）：从标题里能挖的都挖一遍，挖不到的才留给默认值 ——

  // ① 关键词 → 优先级（只有没显式写 P0–P3 时才猜；不改标题，免得「紧急联系人」被吃掉）
  if (p.priority == null) {
    const importance = s.replace(/(?:不|非|无需|不用)(?:紧急|重要|加急)/g, '')
    if (/(紧急|加急|十万火急|立刻|马上|尽快|必须今天|今天就交)/.test(importance)) {
      p.priority = 0
      p.guesses.push('P0 紧急')
    } else if (/(重要|关键|务必|必做|高优先级)/.test(importance)) {
      p.priority = 1
      p.guesses.push('P1 重要')
    } else if (/(不急|不紧急|低优先级|有空|闲了|看情况|随便)/.test(s)) {
      p.priority = 3
      p.guesses.push('P3 不急')
    }
  }

  // 频次写法先于周几抽取：「每周3次」「一周三次」是「每周 N 次」，
  // 不先吃掉的话「每周三」会被下面的周几抽取当成本周三。
  s = s.replace(/(?<![第这每上0-9零〇一二两三四五六七八九十])(?:每(?:个)?|一|1)(?:个)?\s*(?:周|星期|礼拜)(?:之)?内?\s*([0-9一二两三四五六七八九十]+)\s*(?:次|遍|回|轮)/g, (_m, n: string) => {
    const c = cnToNumber(n)
    if (c != null && c >= 1 && c <= 99 && !p.repeat) {
      p.repeat = 'weekly'
      p.repeatCount = c
    }
    return ' '
  })
  // 「一天三次」只比「每天三次」少个字，但「一天」不是重复词，不消费会混进标题
  s = s.replace(/(?<![第这每上0-9零〇一二两三四五六七八九十])一天(?:之内)?\s*([0-9一二两三四五六七八九十]+)\s*(?:次|遍|回|轮)/, (_m, n: string) => {
    const c = cnToNumber(n)
    if (c != null && c >= 1 && c <= 99 && !p.repeat) {
      p.repeat = 'daily'
      p.repeatCount = c
    }
    return ' '
  })

  // 星期先抽取，支持中文、数字、连写、分隔和重复前缀，避免与后面的钟点互相吞字。
  const wd = '[一二三四五六日天0-7]'
  const week = '(?:周|星期|礼拜)'
  s = s.replace(new RegExp(`(?:每(?:个)?)?${week}\\s*(${wd})\\s*(?:到|至|[-~～—])\\s*${week}?\\s*(${wd})`, 'g'), (_m, a: string, b: string) => {
    const days = [cnWeekday(a)]
    while (days.at(-1) !== cnWeekday(b) && days.length < 7) days.push((days.at(-1)! + 1) % 7)
    p.repeat = days.length === 5 && days.every(d => d >= 1 && d <= 5) ? 'weekdays' : 'weekly'
    if (p.repeat === 'weekly') p.repeatDays = [...days].sort((a, b) => a - b)
    p.due = nearestWeekdayDate(days)
    return ' '
  })
  const dayToken = `${wd}(?![点时:：])`
  s = s.replace(new RegExp(`每(?:个)?${week}\\s*(${dayToken}(?:(?:\\s*[、,，和及/\\s]\\s*)?${week}?\\s*${dayToken})*)`, 'g'), (_m, daysText: string) => {
    const days = [...new Set((daysText.match(new RegExp(wd, 'g')) ?? []).map(cnWeekday))].sort((a, b) => a - b)
    p.repeat = 'weekly'
    p.repeatDays = days
    p.due = nearestWeekdayDate(days)
    return ' '
  })
  // 无「每」前缀的连写多天（「周一三五 跑步」「周六日 兼职」）：整体后面必须是空白/结尾，
  // 「周三日语课」这类后接正文的不会误伤（凑不满两个星期字或不在边界）。
  s = s.replace(new RegExp(`(?<![下本这])${week}([一二三四五六日天]{2,6})(?=\\s|$)`, 'g'), (_m, daysText: string) => {
    const days = [...new Set(daysText.split('').map(cnWeekday))].sort((a, b) => a - b)
    if (days.length < 2) return _m
    p.repeat = 'weekly'
    p.repeatDays = days
    if (!p.due) p.due = nearestWeekdayDate(days)
    return ' '
  })
  s = s.replace(new RegExp(`(下下|下|这|本)?(?:个)?${week}\\s*(${wd})(之前|以前|前)?`, 'g'), (_m, prefix: string, day: string, deadline: string) =>
    ` ${prefix === '本' ? '这' : prefix || ''}周${['日', '一', '二', '三', '四', '五', '六'][cnWeekday(day)]}${deadline || ''} `)
  s = s.replace(/(大后天|后天|明天|明日|今天|今日)/g, ' $1 ')

  // 钟点先保护起来：三点二十分中的「二十分」不能被当成预计用时。
  const foundClocks: { hour: number; minute: number; period?: string; literal: boolean }[] = []
  const clockRe = new RegExp(`(?<![第0-9零〇一二两三四五六七八九十])(${PERIOD_ALT}|早|晚)?\\s*(${NUMBER_WORD})(?:[点时](半|[一三1-3]刻|${NUMBER_WORD}分?)?|[:：](${NUMBER_WORD}))(?:整)?(?![0-9零〇一二两三四五六七八九十])`, 'g')
  s = s.replace(clockRe, (match, period: string | undefined, hourWord: string, minuteWord: string | undefined, colonMinute: string | undefined) => {
    const hour = cnToNumber(hourWord)
    const minute = colonMinute ? cnToNumber(colonMinute) : minuteWord === '半' ? 30
      : minuteWord?.endsWith('刻') ? (cnToNumber(minuteWord.slice(0, -1)) ?? 0) * 15
        : minuteWord ? cnToNumber(minuteWord.replace(/分$/, '')) : 0
    if (hour == null || hour > 23 || minute == null || minute > 59) return match
    foundClocks.push({ hour, minute, period, literal: !!colonMinute })
    return ' '
  })

  // ③ 相对时间：「半小时后」「30分钟后」「2小时后」
  //    （必须早于「时长」解析，否则「半小时后」会被当成预计用时 30 分钟）
  const relM = s.match(/((?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)?\s*个?\s*半?\s*(?:分钟|分|小时|钟头))\s*(?:以后|之后|后)/)
  if (relM) {
    const mins = parseDurationMinutes(relM[1])
    if (mins != null && mins > 0 && mins <= 60 * 24 * 30) {
      const at = new Date(now.getTime() + mins * 60000)
      p.due = toDateStr(at)
      p.dueTime = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
      timeFromClock = true
      s = s.replace(relM[0], '')
    }
  }

  // ④ 打卡次数：「喝水 8 次」「每天 3 遍」（「第3次」「这次」「每次」不算）
  const countM = s.match(new RegExp(`(?<![第这那每哪几多好0-9零〇一二两三四五六七八九十])(${NUMBER_WORD})\\s*(?:次|遍|回|轮)`))
  if (countM) {
    const n = cnToNumber(countM[1])
    if (n != null && n >= 1 && n <= 99) {
      p.repeatCount = n
      s = s.replace(countM[0], '')
    }
  }

  // ⑤ 预计用时：「30分钟」「一个半小时」「2小时」（相对时间已在 ③ 消费掉）
  const durM = s.match(/((?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)?\s*个?\s*半?\s*(?:分钟|分|小时|钟头))/)
  if (durM) {
    const mins = parseDurationMinutes(durM[1])
    if (mins != null && mins > 0 && mins <= 60 * 24 * 7) {
      p.estimateMinutes = mins
      s = s.replace(durM[0], '')
    }
  }

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
    '[0-9一二两三四五六七八九十]+个?(?:周|星期|礼拜)[后後]',
    '[0-9一二两三四五六七八九十]+个?月[后後]',
    '半个月[后後]|半年[后後]|一年[后後]',
    '下下周[一二三四五六日天](?!前)',
    '下周[一二三四五六日天](?!前)',
    '这(?:周|星期|礼拜)[一二三四五六日天]+(?![\\s一二三四五六日天前])',
    '每(?:周|星期|礼拜)[一二三四五六日天]+(?![\\s一二三四五六日天前])',
    '(?:周|星期|礼拜)[一二三四五六日天](?!前)',
    '每(?:个)?周末|下周末|周末',
    '每(?:个)?月[0-9一二三四五六七八九十]{1,3}[日号]',
    '下(?:个)?月[0-9一二三四五六七八九十]{1,3}[日号]',
    '[0-9一二两三四五六七八九十]{1,2}月[底末初](?:之前|以前|前)?',
    '(?:每(?:个)?|下个?|本个?)?月[底末](?:之前|以前|前)?|(?:每(?:个)?|下个?|本个?)?月初',
    '下个?月(?![0-9一二三四五六七八九十日号底末初])',
    '每天|每日',
    '每周(?![一二三四五六日天末])',
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
  // ④ 时段词与后文连写（「明天上午交材料」→「明天 上午 交材料」）：
  //    后面紧跟数字的不拆，「下午3点」留给时间解析整体匹配
  s = s.replace(new RegExp(`(^|\\s)(${PERIOD_ALT})(?=[^\\s\\d])`, 'g'), '$1$2 ')

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
  // 「每周末」：周六周日都算；月底没有固定号，用 31 号（推进时会收敛到当月最后一天）
  s = s.replace(/\s每(?:个)?周末(?=\s)/g, () => {
    p.repeat = 'weekly'
    p.repeatDays = [0, 6]
    if (!p.due) p.due = nearestWeekdayDate([0, 6])
    return ' '
  })
  s = s.replace(/\s每(?:个)?月([底末初])(?=\s)/g, (_m, which: string) => {
    p.repeat = 'monthly'
    p.repeatMonthDay = which === '初' ? 1 : 31
    if (!p.due) p.due = nextMonthDay(p.repeatMonthDay)
    return ' '
  })

  // 只写了次数没写周期（「喝水8次」）：按每日打卡理解——写次数的人多半是想天天做。
  // 动词表挡住「提交3次表单」这类一次性动作，猜错也能在预览里看见「每天」这枚 chip。
  if (p.repeatCount && !p.repeat && /(打卡|喝|练|背|跑|读|写|站|做|拉|弹|唱|俯卧撑|深蹲|单词|冥想|锻炼|运动|健身|复习|预习|记账|刷牙|散步|跳绳|拉伸|慢跑|吃药|服药|浇花|喂|拖地|护肤|称重|卷腹|开合跳|平板支撑)/.test(s)) {
    p.repeat = 'daily'
    p.guesses.push('每天')
  }

  // —— 时间：14:00 / 14点 / 下午3点(半) / 中午1点 / 今晚9点 ——
  // 前导空格与时段词前缀都可选；右侧要求是边界（归一化已把连写的「3点开会」拆开），
  // 这样「第3点笔记」「7-11」这类正文不会被误当成时间。
  //
  // v3.1：打卡任务允许写多个时间点（「早8点 晚9点」），这里循环收集：
  // 第一个当 dueTime，其余进 repeatTimes，提醒与列表展示都按它来。
  const clocks: string[] = []
  // 一句里写了多个时间点（「8点、21点」）就按字面取，不把已过的那个推到现在之后：
  // 「明天 8点、21点 巡检」里的 8 点指的是明天，推成今晚 20:00 就错了
  const hasDate = !!p.due || /今天|今日|明天|明日|后天|天[后後]|周[一二三四五六日天]|月.+[日号]|\d{1,4}[-/.]\d{1,2}|月[底末初]|周末|(?:周|星期|礼拜|个月|半年|一年)后/.test(s)
  for (const tm of foundClocks) {
    const mm = tm.minute
    const clock = resolveClock(tm.hour, mm, tm.period, nowMin, Boolean(p.repeat) || foundClocks.length > 1 || hasDate || tm.literal)
    clocks.push(`${pad2(clock.hour)}:${pad2(mm)}`)
    if (clocks.length === 1) dayOffset = clock.dayOffset
    timeFromClock = true
  }
  if (clocks.length) p.dueTime = clocks[0]
  if (p.repeat && clocks.length > 1) p.repeatTimes = [...new Set(clocks)].sort()

  // 只写了时段、没写几点（「明天上午 交材料」）：按常识补一个默认时刻，并标注是猜的
  if (!p.dueTime) {
    const pm = s.match(new RegExp(`\\s(${PERIOD_ALT})\\s`))
    const base = pm ? PERIOD_HOUR[pm[1]] : undefined
    if (pm && base != null) {
      const clock = resolveClock(base, 0, pm[1], nowMin, Boolean(p.repeat))
      p.dueTime = `${pad2(clock.hour)}:00`
      dayOffset = clock.dayOffset
      timeFromClock = true
      p.guesses.push(`${pm[1]}≈${p.dueTime}`)
      s = s.replace(pm[0], ' ')
    }
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
      // 「两周后 / 一个星期后」：按 7 天一周推
      re: /\s([0-9一二两三四五六七八九十]+)个?(?:周|星期|礼拜)后(?=\s)/,
      handle: (m, q) => {
        const n = cnToNumber(m[1])
        if (n != null && n > 0) q.due = addDaysStr(n * 7)
      },
    },
    {
      re: /\s半个月后(?=\s)/,
      handle: (_m, q) => { q.due = addDaysStr(15) },
    },
    {
      // 「一个月后 / 三个月后」：下（N 个）月同一天，日号超出当月收敛到月末
      re: /\s([0-9一二两三四五六七八九十]+)个?月后(?=\s)/,
      handle: (m, q) => {
        const n = cnToNumber(m[1])
        if (n != null && n > 0) q.due = monthDayIn(new Date(), n, new Date().getDate())
      },
    },
    {
      re: /\s(半年|一年)后(?=\s)/,
      handle: (m, q) => { q.due = monthDayIn(new Date(), m[1] === '半年' ? 6 : 12, new Date().getDate()) },
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
      // 「下周末」= 下周六；「周末」= 还没到的最近一个周六
      re: /\s下周末(?=\s)/,
      handle: (_m, q) => { q.due = nextWeekday(6, 1) },
    },
    {
      re: /\s周末(?=\s)/,
      handle: (_m, q) => { q.due = nextWeekday(6, 0) },
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
      re: /\s下(?:个)?月[底末](?:之前|以前|前)?(?=\s)/,
      handle: (_m, q) => { q.due = monthDayIn(new Date(), 1, 31) },
    },
    {
      re: /\s下(?:个)?月[初](?=\s)/,
      handle: (_m, q) => { q.due = monthDayIn(new Date(), 1, 1) },
    },
    {
      // 「下个月」：下个月同一天，日号超出当月收敛到月末
      re: /\s下(?:个)?月(?=\s)/,
      handle: (_m, q) => { q.due = monthDayIn(new Date(), 1, new Date().getDate()) },
    },
    {
      // 「10月底 / 五月末（前）」：那个月的最后一天，已过则顺延到明年同月
      re: /\s([0-9一二两三四五六七八九十]{1,2})月[底末](?:之前|以前|前)?(?=\s)/,
      handle: (m, q) => {
        const mo = cnToNumber(m[1])
        if (mo == null || mo < 1 || mo > 12) return
        const y = new Date().getFullYear()
        const cand = monthDayIn(new Date(y, mo - 1, 1), 0, 31)
        q.due = cand < todayStr() ? monthDayIn(new Date(y + 1, mo - 1, 1), 0, 31) : cand
      },
    },
    {
      // 「10月初」：那个月的 1 号，已过则顺延到明年
      re: /\s([0-9一二两三四五六七八九十]{1,2})月[初](?=\s)/,
      handle: (m, q) => {
        const mo = cnToNumber(m[1])
        if (mo == null || mo < 1 || mo > 12) return
        const y = new Date().getFullYear()
        const cand = `${y}-${pad(String(mo))}-01`
        q.due = cand < todayStr() ? `${y + 1}-${pad(String(mo))}-01` : cand
      },
    },
    {
      // 「月底 / 本月底（前）」：本月最后一天
      re: /\s(?:本(?:个)?)?月[底末](?:之前|以前|前)?(?=\s)/,
      handle: (_m, q) => { q.due = monthDayIn(new Date(), 0, 31) },
    },
    {
      // 「月初 / 本月初」：本月 1 号已过就是下月 1 号
      re: /\s(?:本(?:个)?)?月初(?=\s)/,
      handle: (_m, q) => {
        const n = new Date()
        q.due = n.getDate() === 1 ? toDateStr(n) : monthDayIn(n, 1, 1)
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

  // 时间/次数被挖走后，可能留下孤零零的顿号或逗号（「每天8点、21点 喝水」），清掉首尾
  p.title = s.replace(/\s+/g, ' ').replace(/^[\s、，,。；;：:·]+|[\s、，,。；;：:·]+$/g, '').trim()
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
      case '晚':
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

/**
 * 「30分钟」「半小时」「一个半小时」「2小时」→ 分钟数。
 * 数字可省略（「半小时」），也可带「半」（「一个半小时」= 90）。
 * 解析不出有效值时返回 null，让调用方保留原文。
 */
function parseDurationMinutes(raw: string): number | null {
  const isHour = /小时|钟头/.test(raw)
  const half = /半/.test(raw)
  const m = raw.match(/(\d+(?:\.\d+)?)|([一二两三四五六七八九十]+)/)
  let n = 0
  if (m) n = m[1] ? Number(m[1]) : (cnToNumber(m[2]) ?? 0)
  if (half && n === 0) n = 0.5
  else if (half) n += 0.5
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(isHour ? n * 60 : n)
}

/* ---------------- 日期 ---------------- */

function cnWeekday(ch: string): number {
  if (/^[0-7]$/.test(ch)) return Number(ch) % 7
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
  s = s.replace(/[〇零]/g, '0').replace(/[一二两三四五六七八九]/g, c => String(CN_NUM[c]))
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + Number(s.slice(1) || 0)
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    return Number(a || 1) * 10 + Number(b || 0)
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

/** 供预览展示（v3.1：把次数、多个打卡时间、预计用时也带出来，猜出来的标注「猜」） */
export function parseSummary(parsed: ParsedTask): string[] {
  const out: string[] = []
  const guessed = (tag: string) => parsed.guesses.includes(tag)
  if (parsed.due) {
    const clock = parsed.dueTime && parsed.repeatTimes?.length && parsed.repeatTimes.length > 1
      ? parsed.repeatTimes.join(' / ')
      : parsed.dueTime ?? null
    out.push(fmtDue(parsed.due, clock).text)
  } else if (parsed.dueTime) {
    // 只有时间没有日期时也要显示出来，别让预览空着
    out.push(parsed.repeatTimes?.length && parsed.repeatTimes.length > 1
      ? parsed.repeatTimes.join(' / ')
      : parsed.dueTime)
  }
  if (parsed.repeat) {
    const label = repeatLabel(parsed.repeat, { days: parsed.repeatDays, monthDay: parsed.repeatMonthDay })
    const times = parsed.repeatCount && parsed.repeatCount > 1 ? `${label} ×${parsed.repeatCount}` : label
    out.push(guessed('每天') && parsed.repeat === 'daily' ? `${times}（猜）` : times)
  } else if (parsed.repeatCount && parsed.repeatCount > 1) {
    out.push(`×${parsed.repeatCount} 次`)
  }
  if (parsed.estimateMinutes) out.push(`约 ${parsed.estimateMinutes} 分钟`)
  if (parsed.priority != null) out.push(`P${parsed.priority}`)
  for (const t of parsed.tags) out.push(`#${t}`)
  return out
}
