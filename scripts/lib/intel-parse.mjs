// 榜单解析的纯函数（无网络、无副作用），供抓取脚本与单测共用。
//
// 这里有两个坑都是"静默失败"型的，必须用测试钉住：
// 1. 官方 API v2 的字段是下划线命名（evaluations.artificial_analysis_intelligence_index），
//    公开页面里是驼峰（intelligenceIndex）——只认一种就会解析出 0 条，脚本还以为自己跑成功了；
// 2. 官方把"按默认配置评测"写成「(Max, Default Fallback)」，直接当名字会挤爆卡片。

const MAX = 30

export const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** 推理档位文案清洗：去掉 "Default Fallback" 这类噪音 */
export function cleanEffort(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/default fallback/i.test(s))
    .join(', ')
}

/** 归一化：官方 API 与公开页面解析出来的条目都走这里 */
export function collect(list) {
  const models = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const ev = item.evaluations ?? {}
    const score =
      num(item.score) ??
      num(item.intelligenceIndex) ??
      num(item.intelligence_index) ??
      num(ev.artificial_analysis_intelligence_index) ??
      num(ev.artificialanalysisintelligenceindex)
    const base = item.name ?? item.slug ?? item.model
    if (typeof base !== 'string' || !base || score == null) continue
    const effort = cleanEffort(item.reasoning_effort ?? item.reasoningEffort)
    const creator = typeof item.modelCreatorName === 'string'
      ? item.modelCreatorName
      : typeof item.model_creator?.name === 'string' ? item.model_creator.name : ''
    // 官方页把「按默认配置评测」的模型写成「Claude Opus 5.5 (Max, Default Fallback)」，
    // 榜单一行放不下，去掉这半句只留档位
    const label = base.replace(/,\s*Default Fallback/gi, '').replace(/\s{2,}/g, ' ').trim()
    const name = effort && !label.includes(`(${effort})`) ? `${label} (${effort})` : label
    models.push({ name, score, creator })
  }
  // 同名模型（不同厂家的同名版本）后面加厂家，避免榜单出现两行一样的名字
  const seen = new Map()
  for (const m of models) seen.set(m.name, (seen.get(m.name) ?? 0) + 1)
  const dedup = new Map()
  for (const { name, score, creator } of models) {
    const label = seen.get(name) > 1 && creator ? `${name} · ${creator}` : name
    if (!dedup.has(label)) dedup.set(label, { name: label, score })
  }
  return [...dedup.values()].sort((a, b) => b.score - a.score).slice(0, MAX)
}

/** 官方 API 响应里取模型数组（几种包装形态都认） */
export function listOfApiBody(body) {
  return Array.isArray(body) ? body
    : Array.isArray(body?.models) ? body.models
      : Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.data?.models) ? body.data.models
          : []
}

/**
 * 把 `self.__next_f.push([1,"..."])` 里的字符串解码出来拼成一段文本。
 * RSC 是流式的，一个对象可能被拆在两个 chunk 里，拼接后再解析能拼回去。
 */
export function decodeNextPayload(html) {
  const parts = []
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let m
  while ((m = re.exec(html)) !== null) {
    try {
      parts.push(JSON.parse(m[1]))
    } catch { /* 单个 chunk 解不开就跳过 */ }
  }
  return parts.join('')
}

/** 从 `start` 处的 `{` 配对到闭合的 `}`，跳过字符串与转义；配不上返回 -1 */
export function matchBrace(text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      i++
      while (i < text.length) {
        if (text[i] === '\\') i += 2
        else if (text[i] === '"') break
        else i++
      }
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 从解码后的文本里抠出所有「含 intelligenceIndex 的 JSON 对象」。
 *
 * 必须从每个 `{` 正向配对，不能"从字段位置往回找最近的 `{`"：
 * 模型名里可能带花括号（`A {weird} name`），往回找会落到字符串内部，
 * 配对在字符串里结束 → 解析失败 → 指针没往前走 → 死循环（真实踩过，页面能卡死主线程）。
 */
export function objectsWithIndex(text) {
  const out = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const end = matchBrace(text, i)
    if (end < 0) continue
    const raw = text.slice(i, end + 1)
    if (!raw.includes('"intelligenceIndex"') || raw.length > 20000) continue
    try {
      const obj = JSON.parse(raw)
      if (obj && typeof obj.name === 'string' && typeof obj.intelligenceIndex === 'number') out.push(obj)
    } catch { /* 不是合法对象：继续看里面的嵌套对象 */ }
  }
  return out
}
