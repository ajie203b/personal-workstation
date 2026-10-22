import { LocalNotifications } from '@capacitor/local-notifications'
import { db } from '@/db/db'
import { isNative } from './native'
import type { Task } from '@/db/db'

/**
 * 任务提醒通知（v1.3）：
 * 仅原生壳（安卓 App）内用本地通知精确闹钟调度；网页端无后台能力，静默跳过。
 * 设置存储于 settings 表 key='notifyEnabled'（默认关）。
 */

const SETTINGS_KEY = 'notifyEnabled'

/** 任务 id → 稳定的通知数字 id（LocalNotifications 要求 number） */
function notifIdFor(taskId: string): number {
  let h = 0
  for (let i = 0; i < taskId.length; i++) h = (Math.imul(31, h) + taskId.charCodeAt(i)) | 0
  // 取正数并压进 int32 正区间，减少与系统通知 id 冲突概率
  return (Math.abs(h) % 0x5fffffff) + 1
}

/** 打卡任务最多排 4 个时间点（再多也提醒不过来，反而吵） */
export const MAX_REMINDER_SLOTS = 4

/**
 * 第 n 个提醒的通知 id：第 0 个沿用任务 id 的哈希，
 * 其余按固定步长错开 —— 同一任务的多条提醒必须各有独立 id，否则后一条会顶掉前一条。
 */
function notifIdForSlot(taskId: string, slot: number): number {
  const base = notifIdFor(taskId)
  if (slot <= 0) return base
  return ((base + slot * 1_000_003) % 0x5fffffff) + 1
}

export async function getNotifyEnabled(): Promise<boolean> {
  const row = await db.settings.get(SETTINGS_KEY)
  return row?.value === true
}

export async function setNotifyEnabled(on: boolean): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: on })
  if (!on) await cancelAllTaskNotifications()
}

/**
 * 由 due/dueTime 计算提醒时刻；无时间默认当天 09:00。
 *
 * 旧写法 `hh || 9` 会把合法的 0 点当成「没填」——`00:30` 被排到 09:30。
 * 现在按「先解析、再校验范围」：格式不对或越界才退回默认值，0 是合法值。
 */
export function reminderDateFor(task: Pick<Task, 'due' | 'dueTime'>): Date | null {
  if (!task.due) return null
  const [y, m, d] = task.due.split('-').map(Number)
  if (!y || !m || !d) return null
  const { hh, mm } = parseTimeOfDay(task.dueTime)
  return new Date(y, m - 1, d, hh, mm, 0)
}

/**
 * 一个任务的所有提醒时刻（v3.1）：打卡任务写了多个时间点就各排一条，
 * 没写 repeatTimes 时退回单个 dueTime。
 */
export function reminderDatesFor(task: Pick<Task, 'due' | 'dueTime' | 'repeatTimes'>): Date[] {
  if (!task.due) return []
  const [y, m, d] = task.due.split('-').map(Number)
  if (!y || !m || !d) return []
  const times = task.repeatTimes?.length ? task.repeatTimes : [task.dueTime]
  const out: Date[] = []
  for (const t of times.slice(0, MAX_REMINDER_SLOTS)) {
    const { hh, mm } = parseTimeOfDay(t)
    out.push(new Date(y, m - 1, d, hh, mm, 0))
  }
  return out
}

/** 解析 HH:mm；非法或越界时退回 09:00（0 点是合法值，不能被当成缺省） */
export function parseTimeOfDay(value: string | undefined): { hh: number; mm: number } {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec((value ?? '').trim())
  if (!m) return { hh: 9, mm: 0 }
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return { hh: 9, mm: 0 }
  return { hh, mm }
}

/** 单个任务：按当前状态与到期时间注册/取消提醒（写入路径末尾调用） */
export async function syncTaskNotification(task: Task): Promise<void> {
  if (!isNative() || !(await getNotifyEnabled())) return
  // 先把这个任务的所有时间槽取消干净：时间点从 3 个改成 1 个时，
  // 多出来的旧提醒必须一起撤掉，否则会一直响
  try {
    await LocalNotifications.cancel({
      notifications: Array.from({ length: MAX_REMINDER_SLOTS }, (_, i) => ({ id: notifIdForSlot(task.id, i) })),
    })
  } catch { /* 尚未注册时 cancel 部分机型报错，忽略 */ }
  if (task.status === 'done') return
  const now = Date.now()
  const slots = reminderDatesFor(task)
    .map((at, slot) => ({ at, slot }))
    .filter((s) => s.at.getTime() > now)
  if (!slots.length) return
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted') return
  await LocalNotifications.schedule({
    notifications: slots.map((s) => taskNotification(task, s.at, s.slot, slots.length)),
  })
}

/** 单条 / 全量重排共用同一份通知载荷，避免改一处漏一处 */
function taskNotification(task: Task, at: Date, slot = 0, slots = 1) {
  const time = task.repeatTimes?.[slot] ?? task.dueTime
  const progress = task.repeatCount && task.repeatCount > 1 ? `（第 ${slot + 1}/${slots} 次）` : ''
  return {
    id: notifIdForSlot(task.id, slot),
    title: time ? '任务提醒' : '今天有任务到期',
    body: task.title + (time ? ` · ${time}` : '') + progress,
    schedule: { at, allowWhileIdle: true },
    ongoing: false,
    extra: { taskId: task.id, tier: task.tier },
  }
}

/** 全量重排（应用启动 / 开关打开时调用）：先清后建 */
export async function syncAllTaskNotifications(tasks: Task[]): Promise<void> {
  if (!isNative() || !(await getNotifyEnabled())) return
  await cancelAllTaskNotifications()
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted') return
  const now = Date.now()
  for (const t of tasks) {
    if (t.status === 'done') continue
    const slots = reminderDatesFor(t)
      .map((at, slot) => ({ at, slot }))
      .filter((s) => s.at.getTime() > now)
    if (!slots.length) continue
    try {
      await LocalNotifications.schedule({
        notifications: slots.map((s) => taskNotification(t, s.at, s.slot, slots.length)),
      })
    } catch { /* 单条失败不阻塞 */ }
  }
}

async function cancelAllTaskNotifications(): Promise<void> {
  try {
    const tasks = await db.tasks.toArray()
    const notifications = tasks.flatMap((t) =>
      Array.from({ length: MAX_REMINDER_SLOTS }, (_, i) => ({ id: notifIdForSlot(t.id, i) })),
    )
    if (notifications.length) await LocalNotifications.cancel({ notifications })
  } catch { /* ignore */ }
}

/** 申请通知权限（设置页开关打开时调用） */
export async function requestNotifyPermission(): Promise<boolean> {
  if (!isNative()) return false
  const { LocalNotifications: LN } = await import('@capacitor/local-notifications')
  const res = await LN.requestPermissions()
  return res.display === 'granted'
}

/* ============ 番茄钟结束提醒（v2.0） ============ */

/** 专注结束通知用固定 id，避开任务通知的哈希区间 */
const FOCUS_NOTIF_ID = 2_147_480_000

async function canNotify(): Promise<boolean> {
  if (!isNative()) return false
  try {
    const perm = await LocalNotifications.checkPermissions()
    return perm.display === 'granted'
  } catch {
    return false
  }
}

/**
 * 按 endsAt 排一条本地通知：锁屏 / 切后台也能收到。
 * 网页端没有后台能力，静默跳过；权限没给也跳过。
 */
export async function scheduleFocusEnd(at: number, body: string): Promise<void> {
  if (!isNative() || at <= Date.now()) return
  if (!(await canNotify())) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: FOCUS_NOTIF_ID }] })
    await LocalNotifications.schedule({
      notifications: [
        {
          id: FOCUS_NOTIF_ID,
          title: '专注结束',
          body,
          schedule: { at: new Date(at), allowWhileIdle: true },
          ongoing: false,
          extra: { focus: true },
        },
      ],
    })
  } catch { /* 单次调度失败不影响计时 */ }
}

/** 暂停 / 重置 / 完成时撤销未发出的专注提醒 */
export async function cancelFocusEnd(): Promise<void> {
  if (!isNative()) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: FOCUS_NOTIF_ID }] })
  } catch { /* ignore */ }
}
