import { db, type AiMessage, type AiProvider, type AiSession, type AiUsageRow } from './db'
import { uid } from '@/lib/id'

/* ============ Provider 资产 ============ */

/** 预设厂商模板（OpenAI 兼容） */
export const PROVIDER_PRESETS: { name: string; baseUrl: string; models: string[] }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini'] },
  { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['openai/gpt-4o-mini'] },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5', 'llama3.1'] },
  { name: '自定义', baseUrl: '', models: [] },
]

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
    const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${p.apiKey}` },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const json = (await res.json()) as { data?: { id: string }[] }
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean).sort()
    return { ok: true, models }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
  }
}

/* ============ 会话与消息（五态） ============ */

export async function createSession(input: Omit<AiSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<AiSession> {
  const now = Date.now()
  const s: AiSession = { ...input, id: uid(), createdAt: now, updatedAt: now }
  await db.aiSessions.add(s)
  return s
}

export async function updateSession(id: string, patch: Partial<AiSession>): Promise<void> {
  await db.aiSessions.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', db.aiSessions, db.aiMessages, async () => {
    const msgs = await db.aiMessages.where('sessionId').equals(id).toArray()
    await db.aiMessages.bulkDelete(msgs.map((m) => m.id))
    await db.aiSessions.delete(id)
  })
}

export async function addMessage(input: Omit<AiMessage, 'id' | 'createdAt'>): Promise<AiMessage> {
  const m: AiMessage = { ...input, id: uid(), createdAt: Date.now() }
  await db.aiMessages.add(m)
  await db.aiSessions.update(input.sessionId, { updatedAt: Date.now() })
  return m
}

export async function updateMessage(id: string, patch: Partial<AiMessage>): Promise<void> {
  await db.aiMessages.update(id, patch)
}

export async function recordUsage(row: Omit<AiUsageRow, 'id' | 'ts'>): Promise<void> {
  await db.aiUsage.add({ ...row, id: uid(), ts: Date.now() })
}

/** 默认 Provider：第一个配了 Key 的 */
export async function getDefaultProvider(): Promise<AiProvider | undefined> {
  const all = await db.aiProviders.toArray()
  return all.find((p) => p.apiKey)
}

/** 文档划词 → 问 AI：直接建会话（保留文档来源锚点，方案 2.5） */
export async function startDocAiSession(
  doc: import('./db').Doc,
  quote: string,
  anchor: string,
): Promise<AiSession | null> {
  const provider = await getDefaultProvider()
  if (!provider) return null
  const session = await createSession({
    title: quote.slice(0, 24) || `问《${doc.title}》`,
    providerId: provider.id,
    model: provider.models[0] ?? '',
    sourceModule: 'doc',
    sourceId: doc.id,
    sourceLabel: doc.title,
  })
  await addMessage({
    sessionId: session.id,
    role: 'user',
    content: `我在阅读《${doc.title}》时选中了这段话：\n\n「${quote}」\n\n请解释这段话的含义，如有必要请补充上下文。`,
    state: 'done',
  })
  void anchor // 深链锚点保留在会话来源里，回答页可回跳
  return session
}

/* ============ 用量聚合（时间 × 模型 × 模块） ============ */

export interface UsageAggregate {
  cost: number
  tokensIn: number
  tokensOut: number
  requests: number
  avgLatency: number
  byModel: { model: string; tokens: number; cost: number }[]
  byDay: { day: string; tokens: number; cost: number }[]
  byModule: { module: string; requests: number; tokens: number; cost: number }[]
}

export async function aggregateUsage(days = 30): Promise<UsageAggregate> {
  const since = Date.now() - days * 86400000
  const rows = await db.aiUsage.where('ts').aboveOrEqual(since).toArray()
  const ok = rows.filter((r) => r.ok)
  const cost = ok.reduce((s, r) => s + r.cost, 0)
  const tokensIn = ok.reduce((s, r) => s + r.tokensIn, 0)
  const tokensOut = ok.reduce((s, r) => s + r.tokensOut, 0)
  const latencies = ok.map((r) => r.latencyMs).filter((n) => n > 0)
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0

  const modelMap = new Map<string, { tokens: number; cost: number }>()
  const dayMap = new Map<string, { tokens: number; cost: number }>()
  const moduleMap = new Map<string, { requests: number; tokens: number; cost: number }>()
  for (const r of ok) {
    const m = modelMap.get(r.model) ?? { tokens: 0, cost: 0 }
    m.tokens += r.tokensIn + r.tokensOut
    m.cost += r.cost
    modelMap.set(r.model, m)

    const day = new Date(r.ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    const d = dayMap.get(day) ?? { tokens: 0, cost: 0 }
    d.tokens += r.tokensIn + r.tokensOut
    d.cost += r.cost
    dayMap.set(day, d)

    const mod = moduleMap.get(r.module) ?? { requests: 0, tokens: 0, cost: 0 }
    mod.requests++
    mod.tokens += r.tokensIn + r.tokensOut
    mod.cost += r.cost
    moduleMap.set(r.module, mod)
  }
  const sortDays = (a: string, b: string) => {
    const [am, ad] = a.split('/').map(Number)
    const [bm, bd] = b.split('/').map(Number)
    return am - bm || ad - bd
  }
  return {
    cost,
    tokensIn,
    tokensOut,
    requests: ok.length,
    avgLatency,
    byModel: [...modelMap.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.tokens - a.tokens),
    byDay: [...dayMap.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => sortDays(a.day, b.day)),
    byModule: [...moduleMap.entries()].map(([module, v]) => ({ module, ...v })).sort((a, b) => b.tokens - a.tokens),
  }
}
