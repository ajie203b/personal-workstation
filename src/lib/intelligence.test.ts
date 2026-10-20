import { describe, expect, it } from 'vitest'
import { normalizeIntel } from './intelligence'

describe('normalizeIntel', () => {
  it('官方 API 形态：data 数组 + evaluations 字段', () => {
    const r = normalizeIntel({
      status: 200,
      data: [
        { name: 'Model A', evaluations: { artificialanalysisintelligenceindex: 40 } },
        { name: 'Model B', evaluations: { artificialanalysisintelligenceindex: 55 } },
        { name: 'Model C', evaluations: { artificialanalysisintelligenceindex: '50' } },
      ],
    })
    expect(r?.models.map((m) => [m.name, m.score])).toEqual([
      ['Model B', 55], ['Model C', 50], ['Model A', 40],
    ])
  })

  it('仓库静态文件形态：models:[{name,score}]', () => {
    const r = normalizeIntel({ generatedAt: '2026-10-20T00:00:00Z', models: [{ name: 'X', score: 1 }, { name: 'Y', score: 3 }, { name: 'Z', score: 2 }] })
    expect(r?.models[0]).toEqual({ name: 'Y', score: 3 })
    expect(r?.generatedAt).toBe('2026-10-20T00:00:00Z')
  })

  it('data.models 嵌套形态', () => {
    const r = normalizeIntel({ data: { models: [{ name: 'A', score: 10 }, { name: 'B', score: 12 }, { name: 'C', score: 11 }] } })
    expect(r?.models.map((m) => m.name)).toEqual(['B', 'C', 'A'])
  })

  it('带推理档位时拼进名字', () => {
    const r = normalizeIntel({ models: [
      { name: 'G', score: 9, reasoning_effort: 'high' },
      { name: 'H', score: 8 },
      { name: 'I', score: 7 },
    ] })
    expect(r?.models[0].name).toBe('G (high)')
  })

  it('不足 3 个有效模型视为无效', () => {
    expect(normalizeIntel({ models: [{ name: 'A', score: 1 }] })).toBeNull()
    expect(normalizeIntel({ models: 'nope' })).toBeNull()
    expect(normalizeIntel(null)).toBeNull()
  })

  it('最多保留 30 个', () => {
    const models = Array.from({ length: 50 }, (_, i) => ({ name: `M${i}`, score: 100 - i }))
    expect(normalizeIntel({ models })?.models).toHaveLength(30)
  })
})
