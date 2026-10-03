import { db, type AiProvider } from './db'
import { uid } from '@/lib/id'

/* ============ AI 资产（会员订阅 / API 套餐） ============ */

/** 预设厂商模板（OpenAI 兼容） */
export const PROVIDER_PRESETS: { name: string; baseUrl: string; models: string[] }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini'] },
  { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['openai/gpt-4o-mini'] },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5', 'llama3.1'] },
  { name: '自定义', baseUrl: '', models: [] },
]

/** 会员订阅预设 */
export const SUBSCRIPTION_PRESETS: { name: string; planName: string }[] = [
  { name: 'OpenAI', planName: 'ChatGPT Plus' },
  { name: 'Anthropic', planName: 'Claude Pro' },
  { name: 'Moonshot Kimi', planName: 'Kimi 会员' },
  { name: 'DeepSeek', planName: 'DeepSeek 套餐' },
  { name: '智谱 GLM', planName: 'GLM 币' },
  { name: '自定义', planName: '' },
]

/** 厂商品牌标：名称匹配 → 品牌色字母标 */
const BRAND_MARKS: { match: string[]; mark: string; color: string }[] = [
  { match: ['openai', 'chatgpt', 'gpt'], mark: 'GPT', color: '#10A37F' },
  { match: ['deepseek'], mark: 'DS', color: '#4D6BFE' },
  { match: ['kimi', 'moonshot'], mark: 'K', color: '#1E1E24' },
  { match: ['claude', 'anthropic'], mark: 'C', color: '#D97757' },
  { match: ['gemini', 'google'], mark: 'G', color: '#4285F4' },
  { match: ['通义', 'qwen', '阿里'], mark: '通', color: '#615CED' },
  { match: ['智谱', 'glm', 'chatglm'], mark: 'GLM', color: '#3859FF' },
  { match: ['豆包', 'doubao', '字节'], mark: '豆', color: '#3B82F6' },
  { match: ['grok', 'xai'], mark: 'X', color: '#111111' },
  { match: ['openrouter'], mark: 'OR', color: '#6467F2' },
  { match: ['ollama'], mark: 'OL', color: '#0F172A' },
  { match: ['copilot', 'microsoft', 'azure'], mark: 'MS', color: '#0078D4' },
  { match: ['groq'], mark: 'GQ', color: '#F55036' },
  { match: ['mistral'], mark: 'M', color: '#FA500F' },
  { match: ['腾讯', '混元'], mark: '混', color: '#0052D9' },
  { match: ['百度', '文心'], mark: '文', color: '#2932E1' },
]

export function providerBrand(name: string): { mark: string; color: string } {
  const lower = name.toLowerCase()
  for (const b of BRAND_MARKS) {
    if (b.match.some((m) => lower.includes(m))) return { mark: b.mark, color: b.color }
  }
  return { mark: name.slice(0, 2) || '?', color: '#0B57D0' }
}

export async function addProvider(input: Omit<AiProvider, 'id' | 'createdAt'>): Promise<AiProvider> {
  const p: AiProvider = { ...input, id: uid(), createdAt: Date.now() }
  await db.aiProviders.add(p)
  return p
}

export async function updateProvider(id: string, patch: Partial<AiProvider>): Promise<void> {
  await db.aiProviders.update(id, patch)
}

export async function deleteProvider(id: string): Promise<void> {
  await db.aiProviders.delete(id)
}

/** Key 掩码显示：永不明文回显完整 Key（方案 2.3） */
export function maskKey(key: string): string {
  if (!key) return '未配置'
  if (key.length <= 8) return `****${key.slice(-2)}`
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

/** 连接测试：GET /models */
export async function testProvider(p: AiProvider): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const res = await fetch(`${(p.baseUrl ?? '').replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${p.apiKey ?? ''}` },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const json = (await res.json()) as { data?: { id: string }[] }
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean).sort()
    return { ok: true, models }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
  }
}
