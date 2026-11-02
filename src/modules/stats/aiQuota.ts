export type QuotaDisplayMode = 'none' | 'quota' | 'balance'

export type QuotaEntry = {
  id: string; provider: string; name: string; account: string; kind: '会员' | 'API' | '其他'
  expiresAt: string; resetAt: string; total: number | null; used: number | null; unit: string; note: string; displayMode?: QuotaDisplayMode; balance?: number | null; balanceUnit?: string; sortOrder?: number; updatedAt?: number
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
export { PROVIDERS, quotaBrand } from './quotaBrands'

export function quotaSummary(entry: Pick<QuotaEntry, 'total' | 'used'>) {
  if (entry.total == null || entry.used == null) return null
  return { remaining: Math.max(0, entry.total - entry.used), percent: entry.total > 0 ? Math.min(100, Math.max(0, entry.used / entry.total * 100)) : entry.used > 0 ? 100 : 0, exceeded: entry.used > entry.total }
}


/** 老记录保留原有数字语义：未填写用量的会员不显示空额度。 */
export function quotaDisplayMode(entry: Pick<QuotaEntry, 'kind' | 'total' | 'used' | 'displayMode'>): QuotaDisplayMode {
  if (entry.displayMode === 'none' || entry.displayMode === 'quota' || entry.displayMode === 'balance') return entry.displayMode
  return entry.kind === '会员' && entry.total == null && entry.used == null ? 'none' : 'quota'
}

export function quotaProviderLabel(name: string, provider: string): string {
  const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\s._-]+/g, '')
  const providerKey = normalized(provider)
  return providerKey && normalized(name).includes(providerKey) ? '' : provider
}

export function quotaExpiry(date: string, today: string): { text: string; tone: 'normal' | 'soon' | 'expired' } | null {
  const day = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const [year, month, date] = value.split('-').map(Number)
    const result = new Date(Date.UTC(year, month - 1, date))
    return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === date ? result.getTime() : NaN
  }
  const difference = (day(date) - day(today)) / 86400000
  if (!Number.isFinite(difference)) return null
  if (difference < 0) return { text: `已过期 ${-difference} 天`, tone: 'expired' }
  if (difference === 0) return { text: '今天到期', tone: 'soon' }
  if (difference === 1) return { text: '明天到期', tone: 'soon' }
  return { text: `${difference} 天后到期`, tone: difference <= 7 ? 'soon' : 'normal' }
}

/** 未排序的旧记录保持现有顺序，排在已排序记录之后。 */
export function orderQuotaEntries(entries: QuotaEntry[], preferredIds?: string[] | null): QuotaEntry[] {
  const preferred = preferredIds ? new Map(preferredIds.map((id, index) => [id, index])) : null
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
    const rank = (entry: QuotaEntry) => preferred ? preferred.get(entry.id) ?? Infinity : Number.isFinite(entry.sortOrder) ? entry.sortOrder! : Infinity
    const difference = rank(a.entry) - rank(b.entry)
    return Number.isNaN(difference) || difference === 0 ? a.index - b.index : difference
  }).map(({ entry }) => entry)
}

/** 只改排序字段与更新时间，保留同步期间新建的记录和删除标记。 */
export function applyQuotaOrder(records: QuotaRecord[], ids: string[], now: number): QuotaRecord[] {
  const active = records.filter((item): item is QuotaEntry => !('deleted' in item && item.deleted))
  const ordered = orderQuotaEntries(active, ids)
  const ranks = new Map(ordered.map((entry, index) => [entry.id, index]))
  return records.map(item => {
    if ('deleted' in item) return item
    const sortOrder = ranks.get(item.id)!
    return item.sortOrder === sortOrder ? item : { ...item, sortOrder, updatedAt: Math.max(now, (item.updatedAt ?? 0) + 1) }
  })
}
