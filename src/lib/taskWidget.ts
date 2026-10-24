import { Capacitor, registerPlugin } from '@capacitor/core'
import { db, type Task } from '@/db/db'
import { deriveToday, deriveTodayDone } from '@/db/hooks'
import { addTask, checkinProgress, checkInTask, sortTasks, toggleDone } from '@/db/tasks'
import { todayStr } from '@/lib/date'

export interface TaskWidgetAdd {
  id: string
  title: string
  tier?: string
  createdAt?: number
}

export interface TaskWidgetCheck {
  id: string
  at?: number
}

interface TaskWidgetPlugin {
  update(options: { payload: string }): Promise<void>
  /** 小组件里待同步的添加/完成动作（不清理） */
  take(): Promise<{ adds?: TaskWidgetAdd[]; checks?: TaskWidgetCheck[] }>
  /** 网页侧已写入 IndexedDB 后清空队列 */
  ack(): Promise<void>
}

const TaskWidget = registerPlugin<TaskWidgetPlugin>('TaskWidget')

let draining: Promise<void> | null = null

/**
 * 把小组件里的原生添加/完成动作并进 IndexedDB。
 * App 启动与回到前台时调用；处理成功才 ack，中途失败下次会重试。
 */
export function drainTaskWidgetActions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  if (draining) return draining
  draining = (async () => {
    const pending = await TaskWidget.take()
    const adds = Array.isArray(pending?.adds) ? pending.adds : []
    const checks = Array.isArray(pending?.checks) ? pending.checks : []
    if (!adds.length && !checks.length) return

    for (const add of adds) {
      const id = typeof add?.id === 'string' ? add.id : ''
      const title = typeof add?.title === 'string' ? add.title.trim() : ''
      if (!id || !title) continue
      // 固定 id 去重：上次处理完但没来得及 ack 时不会重复添加
      if (await db.tasks.get(id)) continue
      await addTask({ id, title, tier: add.tier === 'anytime' ? 'anytime' : 'today' })
    }

    for (const check of checks) {
      const id = typeof check?.id === 'string' ? check.id : ''
      const at = typeof check?.at === 'number' ? check.at : 0
      if (!id) continue
      const task = await db.tasks.get(id)
      if (!task || task.status === 'done') continue
      if (task.repeat) {
        if ((task.checkin?.at ?? 0) >= at) continue
        await checkInTask(task)
      } else {
        if ((task.doneAt ?? 0) >= at) continue
        await toggleDone(task)
      }
    }

    await TaskWidget.ack()
    await syncTaskWidgetNow()
  })()
    .catch((e) => {
      console.warn('[task-widget] 同步小组件操作失败', e)
    })
    .finally(() => { draining = null })
  return draining
}

/** 立即把当前 DB 快照推给小组件（drain 后不等 React 的 400ms 防抖） */
export async function syncTaskWidgetNow(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  syncTaskWidget(await db.tasks.toArray())
}

/** App 启动 + 每次回到前台都尝试同步小组件动作 */
export async function initTaskWidgetActions(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}
  await drainTaskWidgetActions()
  const { App } = await import('@capacitor/app')
  const handle = await App.addListener('resume', () => { void drainTaskWidgetActions() })
  return () => { void handle.remove() }
}

/**
 * 把今日待办快照写给原生 AppWidget。
 * 小组件只做展示，点击整张卡回到今日页、点单行直达任务详情；
 * 真正的完成/编辑仍在 App 内。
 *
 * 快照里带 id 是为了深链，带 count/total 是为了在负一屏直接看到打卡进度（2/3）。
 */
export function syncTaskWidget(all: Task[]): void {
  if (!Capacitor.isNativePlatform()) return
  const today = todayStr()
  const pending = sortTasks(deriveToday(all, today))
  const done = deriveTodayDone(all, today).length
  const tasks = pending.slice(0, 4).map((t) => {
    const { count, total } = checkinProgress(t)
    return {
      id: t.id,
      title: t.title.split('\n')[0].slice(0, 40),
      time: t.dueTime ?? '',
      priority: t.priority,
      overdue: !!t.due && t.due < today,
      count: total > 1 ? count : 0,
      total: total > 1 ? total : 0,
    }
  })
  const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
  const payload = JSON.stringify({ date, total: pending.length, done, tasks })
  void TaskWidget.update({ payload }).catch((e) => {
    console.warn('[task-widget] 同步失败', e)
  })
}
