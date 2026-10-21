// 每日抓取模型智能指数，生成 public/intelligence.json
//
// 用法（本地或 GitHub Actions）：
//   AA_API_KEY=xxxx node scripts/fetch-intelligence.mjs   # 有官方 key：走 API
//   node scripts/fetch-intelligence.mjs                    # 没 key：解析官方公开榜单页
//
// 为什么要有第二条路：官方 API 必须带 x-api-key，没配 secret 时这个工作流会天天红，
// 而 public/intelligence.json 从来没被生成过 —— 应用只能一直显示内置快照（榜单「不更新」）。
// 公开榜单页把同一批数据以 React Server Components 的 payload 内嵌在 HTML 里，
// 结构化程度足够解析，所以没 key 时退到这条路，仍然只取智能指数、仍然失败不覆盖旧文件。
//
// 只取智能指数，按分数取前 30，供应用渲染横向榜单。

import fs from 'node:fs/promises'
import path from 'node:path'

const API = 'https://artificialanalysis.ai/api/v2/data/llms/models'
const PAGE = 'https://artificialanalysis.ai/leaderboards/models'
const OUT = path.resolve('public/intelligence.json')
const MAX = 30

const key = process.env.AA_API_KEY?.trim()

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** 归一化：官方 API 与公开页面解析出来的条目都走这里 */
function collect(list) {
  const models = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const ev = item.evaluations ?? {}
    const score =
      num(item.score) ??
      num(item.intelligenceIndex) ??
      num(item.intelligence_index) ??
      // 官方 API v2 是下划线命名（evaluations.artificial_analysis_intelligence_index），
      // 公开页面里是驼峰 —— 两种都得认，否则配了 key 也会解析出 0 个模型
      num(ev.artificial_analysis_intelligence_index) ??
      num(ev.artificialanalysisintelligenceindex)
    const base = item.name ?? item.slug ?? item.model
    if (typeof base !== 'string' || !base || score == null) continue
    const effort = cleanEffort(item.reasoning_effort ?? item.reasoningEffort)
    const creator = typeof item.modelCreatorName === 'string'
      ? item.modelCreatorName
      : typeof item.model_creator?.name === 'string' ? item.model_creator.name : ''
    // 公开页把「按默认配置评测」的模型写成「Claude Opus 5.5 (Max, Default Fallback)」，
    // 榜单卡片一行放不下，去掉这半句只留档位
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

/**
 * 推理档位文案清洗：公开页会把「没单独评测、按默认配置算」的模型标成
 * 「Max, Default Fallback」，榜单里读起来是噪音，只留档位本身。
 */
function cleanEffort(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/default fallback/i.test(s))
    .join(', ')
}

function listOfApiBody(body) {
  return Array.isArray(body) ? body
    : Array.isArray(body?.models) ? body.models
      : Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.data?.models) ? body.data.models
          : []
}

/* ---------- 免密钥兜底：解析公开榜单页里内嵌的 RSC payload ---------- */

/**
 * 把 `self.__next_f.push([1,"..."])` 里的字符串解码出来拼成一段文本。
 * RSC 是流式的，一个对象可能被拆在两个 chunk 里，拼接后再解析能拼回去。
 */
function decodeNextPayload(html) {
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

/** 从解码后的文本里抠出所有「包含 intelligenceIndex 的完整 JSON 对象」 */
function objectsWithIndex(text) {
  const out = []
  const marker = '"intelligenceIndex":'
  let from = 0
  for (;;) {
    const at = text.indexOf(marker, from)
    if (at === -1) break
    const start = text.lastIndexOf('{', at)
    if (start === -1) { from = at + marker.length; continue }
    // 括号配对：跳过字符串内部的花括号
    let depth = 0
    let end = -1
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
        if (depth === 0) { end = i; break }
      }
    }
    if (end < 0) { from = at + marker.length; continue }
    try {
      const obj = JSON.parse(text.slice(start, end + 1))
      if (obj && typeof obj.name === 'string' && typeof obj.intelligenceIndex === 'number') out.push(obj)
    } catch { /* 不是合法对象就跳过 */ }
    from = end + 1
  }
  return out
}

async function fromApi() {
  const res = await fetch(API, { headers: { 'x-api-key': key, accept: 'application/json' } })
  if (!res.ok) throw new Error(`API 请求失败：HTTP ${res.status}`)
  const body = await res.json()
  return { models: collect(listOfApiBody(body)), indexVersion: body?.index_version ?? body?.data?.index_version }
}

async function fromPublicPage() {
  const res = await fetch(PAGE, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; personal-workstation/1.0)' } })
  if (!res.ok) throw new Error(`榜单页请求失败：HTTP ${res.status}`)
  const html = await res.text()
  const rows = objectsWithIndex(decodeNextPayload(html))
  if (!rows.length) throw new Error('榜单页里没有解析到 intelligenceIndex（页面结构可能改了）')
  return { models: collect(rows), indexVersion: undefined }
}

let result
try {
  if (key) {
    result = await fromApi()
    console.log('数据源：官方 API')
  } else {
    console.log('没有 AA_API_KEY，改用公开榜单页解析')
    result = await fromPublicPage()
  }
} catch (e) {
  // 有 key 时 API 失败值得再试一次公开页面（比如配额用完 / 临时 5xx）
  if (key) {
    console.error(`官方 API 失败（${e.message}），改用公开榜单页`)
    try {
      result = await fromPublicPage()
    } catch (e2) {
      console.error(`兜底也失败：${e2.message}；保留旧文件，退出`)
      process.exit(1)
    }
  } else {
    console.error(`${e.message}；保留旧文件，退出`)
    process.exit(1)
  }
}

if (!result.models || result.models.length < 3) {
  console.error(`只解析到 ${result.models?.length ?? 0} 个模型，放弃本次更新（不覆盖旧文件）`)
  process.exit(1)
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: key ? 'https://artificialanalysis.ai/' : PAGE,
  indexVersion: result.indexVersion ?? undefined,
  models: result.models,
}
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`已写入 ${result.models.length} 个模型 → ${OUT}`)
console.log(`榜首：${result.models[0].name} ${result.models[0].score}`)
