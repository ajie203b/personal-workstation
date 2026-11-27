import { describe, expect, it } from 'vitest'
import { detectIntelVendor, normalizeIntel } from './intelligence'
import { INTEL_CHART_META_URLS, INTEL_CHART_URLS, INTEL_JSON_URLS } from './intelSources'

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

  it('官方 API v2 下划线形态：artificial_analysis_intelligence_index 字段', () => {
    const r = normalizeIntel({
      generatedAt: '2026-04-02T08:00:00Z',
      data: [
        { name: 'Claude 4.5 Sonnet', evaluations: { artificial_analysis_intelligence_index: 68.4 } },
        { name: 'GPT-5', reasoning_effort: 'high', evaluations: { artificial_analysis_intelligence_index: 72.1 } },
        { name: 'Gemini 2.5 Pro', evaluations: { artificial_analysis_intelligence_index: 70.5 } },
        { name: 'DeepSeek R1', score: 66.0 },
        { name: 'Broken Model', evaluations: {} },
      ],
    })
    expect(r?.models.map((m) => [m.name, m.score])).toEqual([
      ['GPT-5 (high)', 72.1],
      ['Gemini 2.5 Pro', 70.5],
      ['Claude 4.5 Sonnet', 68.4],
      ['DeepSeek R1', 66],
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

describe('detectIntelVendor', () => {
  it('按模型名准确归类厂商', () => {
    expect(detectIntelVendor('Claude 4.5 Opus')).toBe('Anthropic')
    expect(detectIntelVendor('GPT-5 (high)')).toBe('OpenAI')
    expect(detectIntelVendor('o3-mini')).toBe('OpenAI')
    expect(detectIntelVendor('Gemini 2.5 Pro')).toBe('Google')
    expect(detectIntelVendor('DeepSeek V3.2')).toBe('DeepSeek')
    expect(detectIntelVendor('Qwen3 235B')).toBe('Qwen')
    expect(detectIntelVendor('Grok 4')).toBe('xAI')
    expect(detectIntelVendor('Llama 4 Maverick')).toBe('Meta')
    expect(detectIntelVendor('GLM-4.5')).toBe('Zhipu')
    expect(detectIntelVendor('Kimi K2')).toBe('Moonshot')
    expect(detectIntelVendor('Custom Local Model')).toBe('其他')
  })
})

describe('intelSources ordering', () => {
  it('prioritizes domestic-reachable github.io before raw.githubusercontent.com', () => {
    expect(INTEL_JSON_URLS[0]).toContain('ajie203b.github.io')
    expect(INTEL_JSON_URLS[1]).toContain('raw.githubusercontent.com')
    expect(INTEL_CHART_URLS[0]).toContain('ajie203b.github.io')
    expect(INTEL_CHART_URLS[1]).toContain('raw.githubusercontent.com')
    expect(INTEL_CHART_META_URLS[0]).toContain('ajie203b.github.io')
    expect(INTEL_CHART_META_URLS[1]).toContain('raw.githubusercontent.com')
  })
})
