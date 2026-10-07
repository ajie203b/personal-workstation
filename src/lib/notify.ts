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

export async function getNotifyEnabled(): Promise<boolean> {
  const row = await db.settings.get(SETTINGS_KEY)
  return row?.value === true
}

export async function setNotifyEnabled(on: boolean): Promise<void> {
  await db.settings.put({ key: SETTINGS_KEY, value: on })
  if (!on) await cancelAllTaskNotifications()
}

/** 由 due/dueTime 计算提醒时刻；无时间默认当天 09:00 */
export function reminderDateFor(task: Pick<Task, 'due' | 'dueTime'>): Date | null {
  if (!task.due) return null
  const [y, m, d] = task.due.split('-').map(Number)
  if (!y || !m || !d) return null
  const [hh, mm] = (task.dueTime ?? '09:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh || 9, mm || 0, 0)
}

/** 单个任务：按当前状态与到期时间注册/取消提醒（写入路径末尾调用） */
export async function syncTaskNotification(task: Task): Promise<void> {
  if (!isNative() || !(await getNotifyEnabled())) return
  const id = notifIdFor(task.id)
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] })
  } catch { /* 尚未注册时 cancel 部分机型报错，忽略 */ }
  if (task.status === 'done') return
  const at = reminderDateFor(task)
  if (!at || at.getTime() <= Date.now()) return
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted') return
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: task.dueTime ? '任务提醒' : '今天有任务到期',
        body: task.title + (task.dueTime ? ` · ${task.dueTime}` : ''),
        schedule: { at, allowWhileIdle: true },
        ongoing: false,
        extra: { taskId: task.id },
      },
    ],
  })
}

/** 全量重排（应用启动 / 开关打开时调用）：先清后建 */
export async function syncAllTaskNotifications(tasks: Task[]): Promise<void> {
  if (!isNative() || !(await getNotifyEnabled())) return
  await cancelAllTaskNotifications()
  const perm = await LocalNotifications.checkPermissions()
  if (perm.display !== 'granted') return
  const pending = await LocalNotifications.getPending()
  void pending // cancel above clears ours via ids we track; full clear handled by cancelAllTaskNotifications
  for (const t of tasks) {
    if (t.status === 'done') continue
    const at = reminderDateFor(t)
    if (!at || at.getTime() <= Date.now()) continue
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifIdFor(t.id),
            title: t.dueTime ? '任务提醒' : '今天有任务到期',
            body: t.title + (t.dueTime ? ` · ${t.dueTime}` : ''),
            schedule: { at, allowWhileIdle: true },
            extra: { taskId: t.id },
          },
        ],
      })
    } catch { /* 单条失败不阻塞 */ }
  }
}

async function cancelAllTaskNotifications(): Promise<void> {
  try {
    const tasks = await db.tasks.toArray()
    const notifications = tasks.map((t) => ({ id: notifIdFor(t.id) }))
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
