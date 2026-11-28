import type { Annotation, Doc, FocusSession, Task } from '@/db/db'
import { annotationAnchor } from '@/lib/docLocator'
import { quotaExpiry, type QuotaEntry, type QuotaRecord } from '@/modules/stats/aiQuota'

export const DISMISSED_QUOTA_ALERTS_KEY = 'kairos:dismissed-quota-alerts-v1'
export const QUOTA_RENEW_TAG = '额度续费'

/** 每条额度记录按「id + 到期日」生成提醒键：叉掉后永久不再提醒，续期改到新日期才会再次按需提醒 */
export function quotaAlertKey(entry: Pick<QuotaEntry, 'id' | 'expiresAt'>): string {
  return `${entry.id}::${entry.expiresAt ?? ''}`
}

export function quotaRenewTaskTitle(name: string): string {
  return `续费检查：${name.trim()}`
}

export function loadDismissedQuotaAlerts(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): Set<string> {
  try {
    const raw = storage?.getItem(DISMISSED_QUOTA_ALERTS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

export function dismissQuotaAlerts(
  keys: readonly string[],
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): Set<string> {
  const next = loadDismissedQuotaAlerts(storage)
  for (const key of keys) {
    if (key) next.add(key)
  }
  try {
    storage?.setItem(DISMISSED_QUOTA_ALERTS_KEY, JSON.stringify([...next]))
  } catch {
    /* ignore storage quota errors */
  }
  return next
}

/**
 * 筛选即将到期（默认 3 天内含今天与已过期）的模型额度记录，供今日页提醒与统计页汇总复用。
 */
export function findExpiringQuotas(
  records: readonly QuotaRecord[] | undefined,
  today: string,
  withinDays = 3,
): { entry: QuotaEntry; label: string; tone: 'soon' | 'expired'; daysLeft: number }[] {
  if (!records?.length) return []
  const parseDay = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const [y, m, d] = value.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const todayMs = parseDay(today)
  if (!Number.isFinite(todayMs)) return []

  const out: { entry: QuotaEntry; label: string; tone: 'soon' | 'expired'; daysLeft: number }[] = []
  for (const rec of records) {
    if ('deleted' in rec) continue
    if (!rec.expiresAt) continue
    const exp = quotaExpiry(rec.expiresAt, today)
    if (!exp) continue
    const daysLeft = Math.round((parseDay(rec.expiresAt) - todayMs) / 86_400_000)
    if (daysLeft <= withinDays) {
      out.push({
        entry: rec,
        label: exp.text,
        tone: daysLeft < 0 ? 'expired' : 'soon',
        daysLeft,
      })
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}

/**
 * 一键生成「今日日报」Markdown：汇总今日已完成任务、专注时长、新增阅读批注与待续事项。
 */
export function buildDailyDigestMarkdown(opts: {
  day: string
  doneTasks: readonly Task[]
  pendingTasks: readonly Task[]
  focusSessions: readonly FocusSession[]
  annotations: readonly Annotation[]
  docs: readonly Doc[]
}): string {
  const focusMinutes = opts.focusSessions.reduce((sum, s) => sum + s.minutes, 0)
  const docByHash = new Map(opts.docs.map((d) => [d.hash, d]))
  const taskById = new Map([...opts.doneTasks, ...opts.pendingTasks].map((t) => [t.id, t]))

  const lines: string[] = [
    `# 今日日报 · ${opts.day}`,
    '',
    `> 完成 **${opts.doneTasks.length}** 项任务 · 专注 **${focusMinutes}** 分钟（${opts.focusSessions.length} 个番茄）· 新增 **${opts.annotations.length}** 条阅读批注`,
    '',
  ]

  lines.push('## 已完成任务', '')
  if (opts.doneTasks.length === 0) {
    lines.push('- 今日暂无已完成任务', '')
  } else {
    for (const t of opts.doneTasks) {
      const tags = t.tags.length ? ` ${t.tags.map((tag) => `#${tag}`).join(' ')}` : ''
      lines.push(`- [x] ${t.title}${tags}`)
    }
    lines.push('')
  }

  if (opts.focusSessions.length > 0) {
    lines.push('## 专注投入', '')
    const byTask = new Map<string, number>()
    for (const s of opts.focusSessions) {
      const label = (s.taskId && taskById.get(s.taskId)?.title) || '自由专注'
      byTask.set(label, (byTask.get(label) ?? 0) + s.minutes)
    }
    for (const [label, mins] of [...byTask.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${label}：**${mins}** 分钟`)
    }
    lines.push('')
  }

  if (opts.annotations.length > 0) {
    lines.push('## 今日阅读批注', '')
    for (const a of opts.annotations.slice(0, 15)) {
      const doc = docByHash.get(a.docHash)
      const snippet = a.text.replace(/\r?\n/g, ' ').trim()
      if (doc) {
        const link = `#/docs/${doc.id}?p=${encodeURIComponent(annotationAnchor(doc, a))}&hl=${encodeURIComponent(a.id)}`
        lines.push(`- 《${doc.title}》：${snippet} · [原文](${link})`)
      } else {
        lines.push(`- ${snippet}`)
      }
      if (a.comment?.trim()) lines.push(`  - 思考：${a.comment.trim()}`)
    }
    lines.push('')
  }

  if (opts.pendingTasks.length > 0) {
    lines.push('## 待推进事项', '')
    for (const t of opts.pendingTasks.slice(0, 10)) {
      lines.push(`- [ ] ${t.title}`)
    }
    lines.push('')
  }

  lines.push(`> 生成自 Kairos 个人工作站 · ${opts.day}`, '')
  return lines.join('\n')
}
