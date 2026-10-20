// 每日抓取 Artificial Analysis 智能指数，生成 public/intelligence.json
//
// 用法（本地或 GitHub Actions）：
//   AA_API_KEY=xxxx node scripts/fetch-intelligence.mjs
//
// 官方接口：GET https://artificialanalysis.ai/api/v2/data/llms/models（x-api-key）
// 只取智能指数，按分数取前 30，供应用渲染横向榜单。失败时不覆盖旧文件、退出码非 0。

import fs from 'node:fs/promises'
import path from 'node:path'

const API = 'https://artificialanalysis.ai/api/v2/data/llms/models'
const OUT = path.resolve('public/intelligence.json')
const MAX = 30

const key = process.env.AA_API_KEY
if (!key) {
  console.error('缺少 AA_API_KEY（仓库 Settings → Secrets 里配置，或本地临时导出）')
  process.exit(1)
}

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function collect(body) {
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.data?.models)
          ? body.data.models
          : []
  const models = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const ev = item.evaluations ?? {}
    const score =
      num(item.score) ??
      num(ev.artificialanalysisintelligenceindex) ??
      num(item.intelligence_index) ??
      num(item.intelligenceIndex)
    const base = item.name ?? item.slug ?? item.model
    if (typeof base !== 'string' || !base || score == null) continue
    const effort = item.reasoning_effort ?? item.reasoningEffort
    models.push({ name: typeof effort === 'string' && effort ? `${base} (${effort})` : base, score })
  }
  return models.sort((a, b) => b.score - a.score).slice(0, MAX)
}

const res = await fetch(API, { headers: { 'x-api-key': key, accept: 'application/json' } })
if (!res.ok) {
  console.error(`API 请求失败：HTTP ${res.status}`)
  process.exit(1)
}
const body = await res.json()
const models = collect(body)
if (models.length < 3) {
  console.error(`只解析到 ${models.length} 个模型，放弃本次更新（不覆盖旧文件）`)
  process.exit(1)
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'https://artificialanalysis.ai/',
  indexVersion: body?.index_version ?? body?.data?.index_version ?? undefined,
  models,
}
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`已写入 ${models.length} 个模型 → ${OUT}`)
