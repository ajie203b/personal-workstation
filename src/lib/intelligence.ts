import { db } from '@/db/db'
import { INTEL_JSON_URLS } from './intelSources'

/**
 * 模型智能排名（v2.1）：
 * 结构化模型数据下载与缓存；远端 JSON 由仓库每日 Action 生成并提交。
 * 工具页展示官方榜单原图，不使用这些数据重新绘制图表。
 * 应用不直连 artificialanalysis.ai（跨域 + 离线都不可靠），只读我们自己仓库里的静态数据。
 */

export interface IntelModel {
  name: string
  score: number
  /** 厂商名（新版抓取脚本附带，兼容旧快照缺省） */
  creator?: string
}

export interface IntelData {
  generatedAt: string
  source: string
  indexVersion?: string
  models: IntelModel[]
}

const CACHE_KEY = 'intelData'
const AT_KEY = 'intelFetchedAt'
/** 上次「尝试」的时间（不管成没成）。只用来节流，不参与「更新于」的展示 */
const ATTEMPT_KEY = 'intelAttemptAt'
/** 成功后 2 小时静默刷新一次，配合后台每 4 小时抓取确保及时更新 */
const STALE_MS = 2 * 60 * 60 * 1000
/** 拉取失败后的重试间隔（30 分钟后再试） */
const RETRY_MS = 30 * 60 * 1000
const MAX_MODELS = 200

/** 远端数据源：优先 GitHub Pages（定时 Action 同步至 gh-pages），raw 作为备选 */
const SOURCES = INTEL_JSON_URLS

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** 把官方 API / 仓库静态文件的几种形态归一成 {models:[{name,score,creator?}]} */
export function normalizeIntel(raw: unknown): IntelData | null {
  const body = raw as {
    data?: unknown
    models?: unknown
    generatedAt?: unknown
    source?: unknown
    indexVersion?: unknown
  } | null
  if (!body || typeof body !== 'object') return null

  const list = Array.isArray(body)
    ? (body as unknown[])
    : Array.isArray(body.models)
      ? (body.models as unknown[])
      : Array.isArray(body.data)
        ? (body.data as unknown[])
        : (body.data as { models?: unknown } | undefined)?.models
  if (!Array.isArray(list)) return null

  const models: IntelModel[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const m = item as {
      name?: unknown
      slug?: unknown
      model?: unknown
      score?: unknown
      creator?: unknown
      modelCreatorName?: unknown
      model_creator?: { name?: unknown }
      intelligence_index?: unknown
      intelligenceIndex?: unknown
      reasoning_effort?: unknown
      reasoningEffort?: unknown
      evaluations?: Record<string, unknown>
    }
    const ev = m.evaluations ?? {}
    const score =
      num(m.score) ??
      num(ev.artificialanalysisintelligenceindex) ??
      num(ev.artificial_analysis_intelligence_index) ??
      num(m.intelligence_index) ??
      num(m.intelligenceIndex)
    const base = typeof m.name === 'string' ? m.name : typeof m.slug === 'string' ? m.slug : typeof m.model === 'string' ? m.model : ''
    if (!base || score == null) continue
    const effort = m.reasoning_effort ?? m.reasoningEffort
    const name = typeof effort === 'string' && effort ? `${base} (${effort})` : base
    const rawCreator =
      typeof m.creator === 'string'
        ? m.creator
        : typeof m.modelCreatorName === 'string'
          ? m.modelCreatorName
          : typeof m.model_creator?.name === 'string'
            ? m.model_creator.name
            : ''
    const creator = rawCreator.trim() || undefined
    models.push(creator ? { name, score, creator } : { name, score })
  }
  if (models.length < 3) return null

  models.sort((a, b) => b.score - a.score)
  return {
    generatedAt: typeof body.generatedAt === 'string' ? body.generatedAt : new Date().toISOString(),
    source: typeof body.source === 'string' ? body.source : 'artificialanalysis.ai',
    indexVersion: typeof body.indexVersion === 'string' ? body.indexVersion : undefined,
    models: models.slice(0, MAX_MODELS),
  }
}

const EFFORT_TOKEN_RE =
  /^(?:max|xhigh|extra[\s-]?high|very[\s-]?high|high|medium|med|low|minimal|min|none|off|reasoning|non-reasoning|no[\s-]?reasoning|adaptive(?:\s+reasoning)?|thinking|non-thinking|no[\s-]?thinking|extended[\s-]?thinking|default(?:\s+fallback)?)$/i

function effortRankOfToken(token: string): number {
  const t = token.trim().toLowerCase()
  if (t === 'max') return 70
  if (t === 'xhigh' || /^extra[\s-]?high$/.test(t) || /^very[\s-]?high$/.test(t)) return 60
  if (t === 'high') return 50
  if (/^(?:adaptive(?:\s+reasoning)?|extended[\s-]?thinking|reasoning|thinking)$/.test(t)) return 40
  if (t === 'medium' || t === 'med') return 30
  if (t === 'low') return 20
  if (t === 'minimal' || t === 'min') return 10
  if (/^(?:non-reasoning|no[\s-]?reasoning|non-thinking|no[\s-]?thinking|none|off)$/.test(t)) return 0
  return -1
}

/**
 * 拆出模型的基础名与思考档位等级：
 * - `Claude Fable 5.2 (Max)` → `{ baseName: 'Claude Fable 5.2', effortRank: 70 }`
 * - `DeepSeek R1 (0528)`（非思考档位括号）→ `{ baseName: 'DeepSeek R1 (0528)', effortRank: 5 }`
 */
export function parseModelThinkingVariant(name: string): { baseName: string; effortRank: number } {
  const dotIdx = name.lastIndexOf(' · ')
  const rawTitle = dotIdx >= 0 ? name.slice(0, dotIdx).trim() : name.trim()
  const creatorSuffix = dotIdx >= 0 ? name.slice(dotIdx) : ''

  let working = rawTitle
  let bestEffortRank = -1

  while (true) {
    const m = /\s*\(([^()]+)\)\s*$/.exec(working)
    if (!m) break
    const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) break
    const nonEffort: string[] = []
    let foundEffort = false
    for (const part of parts) {
      if (EFFORT_TOKEN_RE.test(part)) {
        foundEffort = true
        bestEffortRank = Math.max(bestEffortRank, effortRankOfToken(part))
      } else {
        nonEffort.push(part)
      }
    }
    if (!foundEffort) break
    const prefix = working.slice(0, m.index).trim()
    working = nonEffort.length ? `${prefix} (${nonEffort.join(', ')})` : prefix
  }

  return {
    baseName: `${working}${creatorSuffix}`.trim(),
    // 无思考档位后缀的模型（如 Kimi K3.1 Pro、Qwen4 Max）归为默认档 5，高于显式 Non-reasoning (0)
    effortRank: bestEffortRank >= 0 ? bestEffortRank : 5,
  }
}

/**
 * 每个基础模型仅保留「最高思考模式」（与 Artificial Analysis 官网柱状图对应）；
 * 同档位取更高分，最终按分数降序排列。
 */
export function filterHighestThinkingModels(models: readonly IntelModel[]): IntelModel[] {
  const bestByBase = new Map<string, { model: IntelModel; effortRank: number }>()
  for (const model of models) {
    const { baseName, effortRank } = parseModelThinkingVariant(model.name)
    const key = `${baseName.toLowerCase()}::${(model.creator ?? '').toLowerCase()}`
    const prev = bestByBase.get(key)
    if (
      !prev ||
      effortRank > prev.effortRank ||
      (effortRank === prev.effortRank && model.score > prev.model.score)
    ) {
      bestByBase.set(key, { model, effortRank })
    }
  }
  return [...bestByBase.values()]
    .map((entry) => entry.model)
    .sort((a, b) => b.score - a.score)
}

function normalizeCreatorVendor(creator: string): string | null {
  const c = creator.trim()
  if (!c) return null
  if (/anthropic/i.test(c)) return 'Anthropic'
  if (/openai/i.test(c)) return 'OpenAI'
  if (/google/i.test(c)) return 'Google'
  if (/deepseek/i.test(c)) return 'DeepSeek'
  if (/alibaba|qwen/i.test(c)) return 'Qwen'
  if (/zhipu|z\.ai|zai/i.test(c)) return 'Zhipu'
  if (/moonshot|kimi/i.test(c)) return 'Moonshot'
  if (/minimax/i.test(c)) return 'MiniMax'
  if (/tencent|hunyuan/i.test(c)) return 'Tencent'
  if (/xiaomi|mimo/i.test(c)) return 'Xiaomi'
  if (/bytedance|doubao|seed/i.test(c)) return 'ByteDance'
  if (/inclusionai|ant\b|ling/i.test(c)) return 'InclusionAI'
  if (/meituan|longcat/i.test(c)) return 'Meituan'
  if (/stepfun/i.test(c)) return 'StepFun'
  if (/baidu|ernie/i.test(c)) return 'Baidu'
  if (/xai|x\.ai/i.test(c)) return 'xAI'
  if (/meta/i.test(c)) return 'Meta'
  if (/mistral/i.test(c)) return 'Mistral'
  if (/nvidia/i.test(c)) return 'NVIDIA'
  if (/amazon|aws/i.test(c)) return 'Amazon'
  if (/cohere/i.test(c)) return 'Cohere'
  return null
}

/** 按模型名（及可选 creator）推断所属厂商（供排行榜交互列表筛选使用） */
export function detectIntelVendor(name: string, creator?: string): string {
  const s = name.trim()
  if (/^claude(?:\b|[\d.-])/i.test(s)) return 'Anthropic'
  if (/^(?:gpt|o[1-9](?:\b|-)|chatgpt)/i.test(s)) return 'OpenAI'
  if (/^(?:gemini|gemma)(?:\b|[\d.-])/i.test(s)) return 'Google'
  if (/^deepseek(?:\b|[\d.-])/i.test(s)) return 'DeepSeek'
  if (/^(?:qwen|qwq)(?:\b|[\d.-])/i.test(s)) return 'Qwen'
  if (/^grok(?:\b|[\d.-])/i.test(s)) return 'xAI'
  if (/^(?:llama|muse)(?:\b|[\d.-])/i.test(s)) return 'Meta'
  if (/^(?:glm|chatglm)(?:\b|[\d.-])/i.test(s)) return 'Zhipu'
  if (/^(?:kimi|moonshot)(?:\b|[\d.-])/i.test(s)) return 'Moonshot'
  if (/^(?:minimax|abab)(?:\b|[\d.-])/i.test(s)) return 'MiniMax'
  if (/^(?:tencent|hunyuan|hy\d)/i.test(s)) return 'Tencent'
  if (/^mimo(?:\b|[\d.-])/i.test(s)) return 'Xiaomi'
  if (/^(?:doubao|seed)(?:\b|[\d.-])/i.test(s)) return 'ByteDance'
  if (/^(?:ling|ring)(?:\b|[\d.-])/i.test(s)) return 'InclusionAI'
  if (/^longcat(?:\b|[\d.-])/i.test(s)) return 'Meituan'
  if (/^step(?:\b|[\d.-])/i.test(s)) return 'StepFun'
  if (/^ernie(?:\b|[\d.-])/i.test(s)) return 'Baidu'
  if (/^nemotron(?:\b|[\d.-])/i.test(s)) return 'NVIDIA'
  if (/^(?:mistral|mixtral|codestral|pixtral|magistral)(?:\b|[\d.-])/i.test(s)) return 'Mistral'
  if (/^(?:nova|amazon)(?:\b|[\d.-])/i.test(s)) return 'Amazon'
  if (/^command(?:\b|[\d.-])/i.test(s)) return 'Cohere'
  const fromCreator = creator ? normalizeCreatorVendor(creator) : null
  return fromCreator ?? '其他'
}

/** 读取随应用打包的静态 intelligence.json 快照（离线兜底） */
export async function loadBuiltinIntel(signal?: AbortSignal): Promise<IntelData | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}intelligence.json`, { cache: 'no-cache', signal })
    if (!res.ok) return null
    return normalizeIntel(await res.json())
  } catch {
    return null
  }
}

export async function loadCachedIntel(): Promise<IntelData | null> {
  try {
    const row = await db.settings.get(CACHE_KEY)
    const d = row?.value as IntelData | undefined
    return d && Array.isArray(d.models) && d.models.length >= 3 ? d : null
  } catch {
    return null
  }
}

export async function getLastIntelFetch(): Promise<number | null> {
  const row = await db.settings.get(AT_KEY)
  return typeof row?.value === 'number' ? row.value : null
}

async function getLastAttempt(): Promise<number | null> {
  const row = await db.settings.get(ATTEMPT_KEY)
  return typeof row?.value === 'number' ? row.value : null
}

export interface IntelRefresh {
  /** 能用来渲染的数据（可能是缓存） */
  data: IntelData | null
  /** 这一轮是否真的从远端取到了新数据（false = 用了缓存 / 全源失败） */
  fetched: boolean
}

/**
 * 静默刷新：成功后 24 小时最多一次；失败（比如仓库还没生成 intelligence.json）6 小时后再试。
 * 任何失败都不抛错——保留缓存，卡片继续显示内置快照。
 *
 * 「尝试时间」和「成功时间」必须分开记：以前只记一个时间，失败后要么每次打开都重打 404，
 * 要么（记了失败时间）卡片会把内置快照标成「更新于今天」，等于谎报数据新鲜度。
 *
 * 返回值带 fetched 标记：卡片「手动刷新」靠它决定要不要说「已更新」——全源失败时
 * 函数会退回缓存，若只看 data 非空就提示成功，等于把旧数据说成刚更新。
 */
export async function refreshIntelDetailed(force = false): Promise<IntelRefresh> {
  const cached = async (): Promise<IntelRefresh> => ({ data: await loadCachedIntel(), fetched: false })
  if (!force) {
    const existing = await loadCachedIntel()
    const at = await getLastIntelFetch()
    const legacyTruncated = existing != null && existing.models.length <= 30
    if (!legacyTruncated && at && Date.now() - at < STALE_MS) return { data: existing, fetched: false }
    const attempt = await getLastAttempt()
    if (attempt && Date.now() - attempt < RETRY_MS) return { data: existing, fetched: false }
  }
  try {
    await db.settings.put({ key: ATTEMPT_KEY, value: Date.now() })
  } catch { /* 记不上就算了，最多多请求一次 */ }
  for (const url of SOURCES) {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) continue
      const data = normalizeIntel(await res.json())
      if (!data) continue
      await db.settings.put({ key: CACHE_KEY, value: data })
      await db.settings.put({ key: AT_KEY, value: Date.now() })
      return { data, fetched: true }
    } catch {
      /* 换下一个源 */
    }
  }
  return cached()
}

/** 只要数据的调用方用这个（设置页 / 启动钩子） */
export async function refreshIntel(force = false): Promise<IntelData | null> {
  return (await refreshIntelDetailed(force)).data
}
