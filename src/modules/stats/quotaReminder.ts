import { db, type Task } from '@/db/db'
import { addTask } from '@/db/tasks'
import { todayStr } from '@/lib/date'
import { QUOTA_RENEW_TAG, quotaRenewTaskTitle } from '@/modules/today/dailyDigest'
import type { QuotaEntry } from './aiQuota'

const pendingTitles = new Set<string>()

/**
 * 为即将到期的额度创建唯一的「续费检查」今日任务：
 * - 同名未完成任务只能存在一个（含并发防重，避免连续点击生成重复任务）
 * - 显式写入 startAt = Date.now()，即使到期日在未来几天也可立即点击完成
 */
export async function createSingleQuotaRenewTask(
  entry: Pick<QuotaEntry, 'name' | 'expiresAt'>,
  today = todayStr(),
): Promise<{ created: boolean; title: string }> {
  const title = quotaRenewTaskTitle(entry.name)
  if (pendingTitles.has(title)) return { created: false, title }
  pendingTitles.add(title)
  try {
    const existing = await db.tasks.filter((t) => t.status !== 'done' && t.title === title).first()
    if (existing) {
      if (existing.startAt == null && existing.tier === 'today') {
        const now = Date.now()
        await db.tasks.update(existing.id, { startAt: Math.min(existing.createdAt || now, now), updatedAt: now })
      }
      return { created: false, title }
    }
    const now = Date.now()
    await addTask({
      title,
      tier: 'today',
      priority: 1,
      startAt: now,
      due: entry.expiresAt && entry.expiresAt >= today ? entry.expiresAt : today,
      tags: [QUOTA_RENEW_TAG],
    })
    return { created: true, title }
  } finally {
    pendingTitles.delete(title)
  }
}

/**
 * 自动修复旧版创建的「额度续费」今日任务：旧版未设置 startAt 且 due 为未来到期日，
 * 会被 isFutureTask 禁用完成勾选；补齐 startAt 后可立即点击完成。
 */
export async function unlockLegacyQuotaRenewTasks(tasks: readonly Task[], today = todayStr()): Promise<number> {
  const stuck = tasks.filter(
    (t) =>
      t.status !== 'done' &&
      t.tier === 'today' &&
      t.startAt == null &&
      Boolean(t.due && t.due > today) &&
      (t.tags.includes(QUOTA_RENEW_TAG) || t.title.startsWith('续费检查：')),
  )
  if (!stuck.length) return 0
  const now = Date.now()
  await Promise.all(
    stuck.map((t) => db.tasks.update(t.id, { startAt: Math.min(t.createdAt || now, now), updatedAt: now })),
  )
  return stuck.length
}
