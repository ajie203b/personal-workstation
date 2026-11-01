import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchApiRanking } from './lib/intel-api.mjs'

test('读取全部分页后排序，使用免费接口和现有密钥', async () => {
  const calls = []
  const result = await fetchApiRanking('test-key', async (url, options) => {
    calls.push([url, options])
    const page = Number(url.searchParams.get('page'))
    return { ok: true, json: async () => ({ intelligence_index_version: 5, pagination: { page, total_pages: 2, has_more: page === 1 }, data: [{ name: `model ${page}`, evaluations: { artificial_analysis_intelligence_index: page * 10 } }, ...(page === 2 ? [{ name: 'third', score: 1 }] : [])] }) }
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0].pathname, '/api/v2/language/models/free')
  assert.equal(calls[0][1].headers['x-api-key'], 'test-key')
  assert.equal(result.models[0].name, 'model 2')
  assert.equal(result.indexVersion, 'v5.0')
})

test('后续页失败或分页异常时拒绝返回不完整榜单', async () => {
  await assert.rejects(fetchApiRanking('key', async url => Number(url.searchParams.get('page')) === 1
    ? { ok: true, json: async () => ({ intelligence_index_version: 5, pagination: { page: 1, total_pages: 2, has_more: true }, data: [] }) }
    : { ok: false, status: 429 }), /429/)
  await assert.rejects(fetchApiRanking('key', async () => ({ ok: true, json: async () => ({ data: [], pagination: { page: 1, total_pages: 2, has_more: false } }) })), /分页格式异常/)
})
