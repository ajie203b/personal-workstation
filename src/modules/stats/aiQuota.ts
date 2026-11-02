export type QuotaEntry = {
  id: string; provider: string; name: string; account: string; kind: '会员' | 'API' | '其他'
  expiresAt: string; resetAt: string; total: number | null; used: number | null; unit: string; note: string; updatedAt?: number
}
export type QuotaDeleted = { id: string; deleted: true; updatedAt: number }
export type QuotaRecord = QuotaEntry | QuotaDeleted

export const QUOTA_KEY = 'aiQuotaEntries'

/** 旧记录无时间戳视为 0；删除标记永久保留，避免离线设备恢复已删除的记录。 */
export function mergeQuotaRecords(a: unknown, b: unknown): QuotaRecord[] {
  if ((a != null && !Array.isArray(a)) || (b != null && !Array.isArray(b))) throw new Error('额度同步数据格式错误')
  const result = new Map<string, QuotaRecord>()
  for (const item of [...(a ?? []), ...(b ?? [])] as QuotaRecord[]) {
    if (!item || typeof item.id !== 'string' || !item.id) throw new Error('额度记录缺少标识')
    const existing = result.get(item.id)
    if (!existing) { result.set(item.id, item); continue }
    const deleted = 'deleted' in item && item.deleted === true
    const previousDeleted = 'deleted' in existing && existing.deleted === true
    if (deleted !== previousDeleted) { if (deleted) result.set(item.id, item); continue }
    const time = item.updatedAt ?? 0
    const previousTime = existing.updatedAt ?? 0
    if (time > previousTime || (time === previousTime && JSON.stringify(item) > JSON.stringify(existing))) result.set(item.id, item)
  }
  return [...result.values()].sort((x, y) => x.id.localeCompare(y.id))
}
export const PROVIDERS = ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', '阿里云百炼', '智谱 AI', '月之暗面', 'MiniMax', '其他'] as const

export function quotaSummary(entry: Pick<QuotaEntry, 'total' | 'used'>) {
  if (entry.total == null || entry.used == null) return null
  return { remaining: Math.max(0, entry.total - entry.used), percent: entry.total > 0 ? Math.min(100, Math.max(0, entry.used / entry.total * 100)) : entry.used > 0 ? 100 : 0, exceeded: entry.used > entry.total }
}
