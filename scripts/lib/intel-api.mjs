import { collect } from './intel-parse.mjs'

const API = 'https://artificialanalysis.ai/api/v2/language/models/free'

export async function fetchApiRanking(key, request = fetch) {
  const rows = []
  let version
  for (let page = 1; page <= 100; page++) {
    const url = new URL(API)
    url.searchParams.set('page', String(page))
    const res = await request(url, { headers: { 'x-api-key': key, accept: 'application/json' } })
    if (!res.ok) throw new Error(`API 请求失败：HTTP ${res.status}`)
    const body = await res.json()
    const p = body?.pagination
    if (!Array.isArray(body?.data) || !p || p.page !== page || !Number.isInteger(p.total_pages) || p.total_pages < 1 || typeof p.has_more !== 'boolean' || p.has_more !== (page < p.total_pages)) {
      throw new Error('API 分页格式异常')
    }
    if (typeof body.intelligence_index_version !== 'number' || !Number.isFinite(body.intelligence_index_version)) throw new Error('API 指数版本无效')
    if (page > 1 && body.intelligence_index_version !== version) throw new Error('API 分页指数版本不一致')
    version = body.intelligence_index_version
    rows.push(...body.data)
    if (!p.has_more) {
      const models = collect(rows)
      if (models.length < 3) throw new Error('API 返回有效模型过少')
      return { models, indexVersion: `v${version.toFixed(1)}` }
    }
  }
  throw new Error('API 分页超过安全上限')
}
