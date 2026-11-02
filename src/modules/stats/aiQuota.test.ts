import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PROVIDER_GROUPS } from './quotaBrands'
import { describe, expect, it } from 'vitest'
import { mergeQuotaRecords, quotaSummary, quotaDisplayMode, quotaExpiry, quotaProviderLabel, quotaBrand, orderQuotaEntries, applyQuotaOrder } from './aiQuota'

describe('额度计算', () => {
  it('计算剩余量与进度', () => expect(quotaSummary({ total: 100, used: 35 })).toEqual({ remaining: 65, percent: 35, exceeded: false }))
  it('缺少数据时不伪造剩余额度', () => expect(quotaSummary({ total: null, used: 0 })).toBeNull())
  it('超额时进度封顶并提示超额', () => expect(quotaSummary({ total: 100, used: 120 })).toEqual({ remaining: 0, percent: 100, exceeded: true }))
  it('零额度仍能正确标识已超额', () => expect(quotaSummary({ total: 0, used: 1 })).toEqual({ remaining: 0, percent: 100, exceeded: true }))
})

describe('额度记录同步', () => {
  it('合并两端新建与旧格式记录，并采用较新的修改', () => {
    const a = { id: 'a', name: 'old' }
    const b = { id: 'b', name: 'new' }
    const newer = { id: 'a', name: 'edited', updatedAt: 5 }
    expect(mergeQuotaRecords([a], [b, newer])).toEqual([newer, b])
  })
  it('删除标记不被离线设备旧数据复活，合并顺序不影响结果', () => {
    const entry = { id: 'a', name: 'old', updatedAt: 10 }
    const deleted = { id: 'a', deleted: true, updatedAt: 9 }
    expect(mergeQuotaRecords([entry], [deleted])).toEqual([deleted])
    expect(mergeQuotaRecords([deleted], [entry])).toEqual([deleted])
  })
  it('相同时间的不同内容采用确定性结果', () => {
    const a = { id: 'a', name: 'first', updatedAt: 1 }
    const b = { id: 'a', name: 'second', updatedAt: 1 }
    expect(mergeQuotaRecords([a], [b])).toEqual(mergeQuotaRecords([b], [a]))
  })
  it('拒绝损坏的同步记录', () => expect(() => mergeQuotaRecords([], {})).toThrow())
})


describe('额度记录展示', () => {
  it('普通会员不要求记录额度，旧会员的已有额度仍保留展示', () => {
    expect(quotaDisplayMode({ kind: '会员', total: null, used: null })).toBe('none')
    expect(quotaDisplayMode({ kind: '会员', total: 310, used: null })).toBe('quota')
    expect(quotaDisplayMode({ kind: 'API', total: null, used: null })).toBe('quota')
    expect(quotaDisplayMode({ kind: 'API', total: 100, used: 20, displayMode: 'balance' })).toBe('balance')
  })
  it('只隐藏名称中已经包含的厂商，保留不同厂商名称', () => {
    expect(quotaProviderLabel('xiaomi mimo pro', 'xiaomi mimo')).toBe('')
    expect(quotaProviderLabel('deepseek', 'DeepSeek')).toBe('')
    expect(quotaProviderLabel('Gemini Plus', 'Google')).toBe('Google')
    expect(quotaProviderLabel('ChatGPT Plus', 'OpenAI')).toBe('OpenAI')
  })
  it('按自然日突出到期状态，跨年正确', () => {
    expect(quotaExpiry('2027-01-01', '2026-12-31')).toEqual({ text: '明天到期', tone: 'soon' })
    expect(quotaExpiry('2026-11-02', '2026-11-02')).toEqual({ text: '今天到期', tone: 'soon' })
    expect(quotaExpiry('2026-11-01', '2026-11-02')).toEqual({ text: '已过期 1 天', tone: 'expired' })
    expect(quotaExpiry('2026-12-01', '2026-11-02')).toEqual({ text: '29 天后到期', tone: 'normal' })
    expect(quotaExpiry('', '2026-11-02')).toBeNull()
  })
  it('优先识别模型品牌并为常见厂商提供离线图标', () => {
    expect(quotaBrand('Gemini Plus', 'Google')).toBe('lobe-gemini-color')
    expect(quotaBrand('longcat2.5', '美团')).toBe('lobe-longcat-color')
    expect(quotaBrand('xiaomi mimo pro', 'xiaomi mimo')).toBe('lobe-xiaomimimo')
    expect(quotaBrand('ChatGPT Plus', 'OpenAI')).toBe('lobe-openai')
    expect(quotaBrand('自定义服务', '未知厂商')).toBeNull()
  })
})


describe('供应商品牌预设', () => {
  it('覆盖常见模型厂商和平台，每个预设都有本地图标', () => {
    const presets = PROVIDER_GROUPS.flatMap(group => group.providers)
    expect(presets.length).toBeGreaterThanOrEqual(35)
    for (const preset of presets) {
      expect(existsSync(resolve('public/brands', `${preset.logo}.svg`)), preset.name).toBe(true)
      expect(quotaBrand(preset.name, preset.name), preset.name).toBe(preset.logo)
    }
    for (const name of ['OpenRouter', 'PackyCode', '魔搭 ModelScope', '硅基流动', '火山引擎', '通义千问', 'xAI']) {
      expect(presets.some(preset => preset.name === name), name).toBe(true)
    }
  })
  it('已有自定义厂商别名能匹配，明确的第三方平台优先于其提供的模型', () => {
    expect(quotaBrand('packyapi', 'packyapi')).toBe('cc-packycode')
    expect(quotaBrand('Claude Opus', 'PackyAPI')).toBe('cc-packycode')
    expect(quotaBrand('GPT 套餐', 'OpenRouter')).toBe('lobe-openrouter-color')
    expect(quotaBrand('Claude 订阅', 'AICodeMirror')).toBe('cc-aicodemirror')
    expect(quotaBrand('通义千问', '阿里云百炼')).toBe('lobe-qwen-color')
    expect(quotaBrand('Sparkling water', '未知厂商')).toBeNull()
  })
})

describe('额度卡片排序', () => {
  const entry = (id: string, sortOrder?: number) => ({ id, provider: 'OpenAI', name: id, account: '', kind: 'API' as const, expiresAt: '', resetAt: '', total: null, used: null, unit: 'Token', note: '', sortOrder })
  it('旧记录保持原有顺序，新记录追加到已排序的记录之后', () => {
    const entries = [entry('old-b'), entry('old-a'), entry('sorted', 0)]
    expect(orderQuotaEntries(entries).map(item => item.id)).toEqual(['sorted', 'old-b', 'old-a'])
  })
  it('保存顺序时保留内容、删除标记和并发新增项，并更新修改时间供同步使用', () => {
    const records = [entry('a'), { ...entry('b'), updatedAt: 500 }, { id: 'gone', deleted: true as const, updatedAt: 20 }, entry('new')]
    const ordered = applyQuotaOrder(records, ['b', 'a'], 100)
    expect(orderQuotaEntries(ordered.filter((item): item is ReturnType<typeof entry> => !('deleted' in item))).map(item => item.id)).toEqual(['b', 'a', 'new'])
    expect(ordered.find(item => item.id === 'b')).toMatchObject({ name: 'b', sortOrder: 0, updatedAt: 501 })
    expect(ordered.find(item => item.id === 'gone')).toEqual(records[2])
  })
})
