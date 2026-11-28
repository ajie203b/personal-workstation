import { describe, expect, it } from 'vitest'
import { detectIntelVendor, filterHighestThinkingModels, normalizeIntel, parseModelThinkingVariant } from './intelligence'
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

  it('最多保留 200 个并透传 creator', () => {
    const models = Array.from({ length: 240 }, (_, i) => ({
      name: `M${i}`,
      score: 300 - i,
      creator: i === 0 ? 'DeepSeek' : undefined,
    }))
    const normalized = normalizeIntel({ models })
    expect(normalized?.models).toHaveLength(200)
    expect(normalized?.models[0].creator).toBe('DeepSeek')
  })
})

describe('filterHighestThinkingModels & parseModelThinkingVariant', () => {
  it('每个基础模型仅保留最高思考档位并保留非思考档位版本括号', () => {
    expect(parseModelThinkingVariant('DeepSeek R1 (0528)')).toEqual({
      baseName: 'DeepSeek R1 (0528)',
      effortRank: 5,
    })
    expect(parseModelThinkingVariant('Claude Fable 5.2 (Max)')).toEqual({
      baseName: 'Claude Fable 5.2',
      effortRank: 70,
    })

    const filtered = filterHighestThinkingModels([
      { name: 'Claude Fable 5.2 (Max)', score: 64.8 },
      { name: 'Claude Fable 5.2 (Xhigh)', score: 62.2 },
      { name: 'Claude Fable 5.2 (High)', score: 61.9 },
      { name: 'Gemini 4 Neon (Xhigh)', score: 61.5 },
      { name: 'Gemini 4 Neon (Medium)', score: 54.9 },
      { name: 'Kimi K3.1 Pro', score: 47.0 },
      { name: 'DeepSeek R1 (0528)', score: 41.2 },
      { name: 'DeepSeek V3.2 (Non-reasoning)', score: 38.0 },
      { name: 'DeepSeek V3.2 (Reasoning)', score: 44.5 },
    ])
    expect(filtered.map((m) => m.name)).toEqual([
      'Claude Fable 5.2 (Max)',
      'Gemini 4 Neon (Xhigh)',
      'Kimi K3.1 Pro',
      'DeepSeek V3.2 (Reasoning)',
      'DeepSeek R1 (0528)',
    ])
  })
})

describe('detectIntelVendor', () => {
  it('按模型名与 creator 准确归类国际与国产主流厂商', () => {
    expect(detectIntelVendor('Claude 4.5 Opus')).toBe('Anthropic')
    expect(detectIntelVendor('GPT-5 (high)')).toBe('OpenAI')
    expect(detectIntelVendor('o3-mini')).toBe('OpenAI')
    expect(detectIntelVendor('Gemini 2.5 Pro')).toBe('Google')
    expect(detectIntelVendor('DeepSeek V3.2')).toBe('DeepSeek')
    expect(detectIntelVendor('Qwen4 Max')).toBe('Qwen')
    expect(detectIntelVendor('Grok 4.7')).toBe('xAI')
    expect(detectIntelVendor('Llama 4 Maverick')).toBe('Meta')
    expect(detectIntelVendor('Muse Wonder Full (Max)')).toBe('Meta')
    expect(detectIntelVendor('GLM-5.3 (Max)')).toBe('Zhipu')
    expect(detectIntelVendor('Kimi K3.1 Pro')).toBe('Moonshot')
    expect(detectIntelVendor('Tencent Hy4')).toBe('Tencent')
    expect(detectIntelVendor('MiMo-V2.6-Pro')).toBe('Xiaomi')
    expect(detectIntelVendor('Ling 3.1 Flash 1019')).toBe('InclusionAI')
    expect(detectIntelVendor('LongCat 2.5')).toBe('Meituan')
    expect(detectIntelVendor('Doubao Seed 1.6')).toBe('ByteDance')
    expect(detectIntelVendor('Nemotron 3.5 Super VL')).toBe('NVIDIA')
    expect(detectIntelVendor('Mystery Model', 'Z.ai')).toBe('Zhipu')
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
