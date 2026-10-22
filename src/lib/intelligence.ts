import { db } from '@/db/db'

/**
 * 模型智能排名（v2.1）：
 * 结构化模型数据下载与缓存；远端 JSON 由仓库每日 Action 生成并提交。
 * 工具页展示官方榜单原图，不使用这些数据重新绘制图表。
 * 应用不直连 artificialanalysis.ai（跨域 + 离线都不可靠），只读我们自己仓库里的静态数据。
 */

export interface IntelModel {
  name: string
  score: number
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
const DAY_MS = 24 * 60 * 60 * 1000
/** 拉取失败后的重试间隔（成功则按 24h 走） */
const RETRY_MS = 6 * 60 * 60 * 1000
const MAX_MODELS = 30

/** 远端数据源：优先 raw（每日 Action 直接提交到这里），Pages 作为备选 */
const SOURCES = [
  'https://raw.githubusercontent.com/ajie203b/personal-workstation/main/public/intelligence.json',
  'https://ajie203b.github.io/personal-workstation/intelligence.json',
]

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** 把官方 API / 仓库静态文件的几种形态归一成 {models:[{name,score}]} */
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
      num(ev['artificialanalysisintelligenceindex']) ??
      num(m.intelligence_index) ??
      num(m.intelligenceIndex)
    const base = typeof m.name === 'string' ? m.name : typeof m.slug === 'string' ? m.slug : typeof m.model === 'string' ? m.model : ''
    if (!base || score == null) continue
    const effort = m.reasoning_effort ?? m.reasoningEffort
    const name = typeof effort === 'string' && effort ? `${base} (${effort})` : base
    models.push({ name, score })
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
    const at = await getLastIntelFetch()
    if (at && Date.now() - at < DAY_MS) return cached()
    const attempt = await getLastAttempt()
    if (attempt && Date.now() - attempt < RETRY_MS) return cached()
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
