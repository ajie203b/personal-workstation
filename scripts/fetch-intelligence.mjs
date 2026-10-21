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
// 解析逻辑在 scripts/lib/intel-parse.mjs（纯函数、有单测：npm run test:scripts）。

import fs from 'node:fs/promises'
import path from 'node:path'
import { collect, decodeNextPayload, listOfApiBody, objectsWithIndex } from './lib/intel-parse.mjs'

const API = 'https://artificialanalysis.ai/api/v2/data/llms/models'
const PAGE = 'https://artificialanalysis.ai/leaderboards/models'
const OUT = path.resolve('public/intelligence.json')

const key = process.env.AA_API_KEY?.trim()

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
