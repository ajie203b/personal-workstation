// 榜单解析的回归测试：这些用例都是线上真踩过的坑（字段命名、名字噪音、RSC 拆包）
// 跑法：npm run test:scripts（node 内置 test runner，不依赖 vitest）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect, decodeNextPayload, listOfApiBody, objectsWithIndex } from './lib/intel-parse.mjs'

test('官方 API v2：下划线字段 artificial_analysis_intelligence_index 能识别', () => {
  const body = {
    status: { all: 200 },
    data: [
      {
        name: 'Claude Opus 5.5 (Max, Default Fallback)',
        model_creator: { name: 'Anthropic' },
        evaluations: { artificial_analysis_intelligence_index: 57.6, mmlu_pro: null },
      },
      { name: 'Muse Wonder Full', model_creator: { name: 'Meta' }, evaluations: { artificial_analysis_intelligence_index: 55.8 } },
      { name: 'GPT-6 Astra (Max)', evaluations: { artificial_analysis_intelligence_index: 52.7 } },
    ],
  }
  const models = collect(listOfApiBody(body))
  assert.equal(models.length, 3)
  assert.equal(models[0].name, 'Claude Opus 5.5 (Max)')
  assert.equal(Math.round(models[0].score * 10) / 10, 57.6)
  assert.deepEqual(models.map((m) => m.name), ['Claude Opus 5.5 (Max)', 'Muse Wonder Full', 'GPT-6 Astra (Max)'])
})

test('公开页：驼峰 intelligenceIndex 能识别，且按分数降序', () => {
  const rows = [
    { name: 'A', intelligenceIndex: 30 },
    { name: 'B', intelligenceIndex: 55 },
    { name: 'C', intelligenceIndex: 40 },
  ]
  assert.deepEqual(collect(rows).map((m) => m.name), ['B', 'C', 'A'])
})

test('名字里的 Default Fallback 被去掉，推理档位拼在后面', () => {
  assert.equal(collect([{ name: 'X (Xhigh, Default Fallback)' }, { name: 'Y' }, { name: 'Z' }].map((o, i) => ({ ...o, score: 10 - i })))[0].name, 'X (Xhigh)')
  const withEffort = collect([{ name: 'M', score: 9, reasoning_effort: 'high' }, { name: 'N', score: 8 }, { name: 'O', score: 7 }])
  assert.equal(withEffort[0].name, 'M (high)')
  // 名字里已经带同样的档位就不要再拼一遍
  const already = collect([{ name: 'M (high)', score: 9, reasoning_effort: 'high' }, { name: 'N', score: 8 }, { name: 'O', score: 7 }])
  assert.equal(already[0].name, 'M (high)')
})

test('同名模型加厂家区分，最多保留 30 条', () => {
  const dup = collect([
    { name: 'Same', score: 9, model_creator: { name: 'A厂' } },
    { name: 'Same', score: 8, model_creator: { name: 'B厂' } },
    { name: 'Other', score: 7 },
  ])
  assert.deepEqual(dup.map((m) => m.name), ['Same · A厂', 'Same · B厂', 'Other'])

  const many = Array.from({ length: 50 }, (_, i) => ({ name: `M${i}`, score: 100 - i }))
  assert.equal(collect(many).length, 30)
  assert.equal(collect(many)[0].score, 100)
})

test('无效条目被跳过（没有分数 / 没有名字 / 非对象）', () => {
  const models = collect([null, 42, { name: 'no-score' }, { name: 'ok', score: 5 }, { score: 9 }, 'x'])
  assert.deepEqual(models.map((m) => m.name), ['ok'])
})

test('RSC payload：拆在多个 chunk 里的对象能被拼回来', () => {
  // 模拟 self.__next_f.push([1,"..."])：引号被转义成 \"，对象被切成两段
  const chunk1 = 'self.__next_f.push([1,"{\\"name\\":\\"Claude\\",\\"intelligenceIndex\\":57.6,\\"modelCreatorName\\":\\"Anthro"])'
  const chunk2 = 'self.__next_f.push([1,"pic\\"}"])'
  const text = decodeNextPayload(chunk1 + chunk2)
  const rows = objectsWithIndex(text)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Claude')
  assert.equal(rows[0].intelligenceIndex, 57.6)
})

test('RSC 解析不会把字符串里的花括号当对象边界', () => {
  const payload = { name: 'A {weird} name', intelligenceIndex: 1, note: 'x' }
  const html = `self.__next_f.push([1,${JSON.stringify(JSON.stringify(payload))}])`
  const rows = objectsWithIndex(decodeNextPayload(html))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'A {weird} name')
})
