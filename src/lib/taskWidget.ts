import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Task } from '@/db/db'
import { deriveToday, deriveTodayDone } from '@/db/hooks'
import { checkinProgress, sortTasks } from '@/db/tasks'
import { todayStr } from '@/lib/date'

interface TaskWidgetPlugin {
  update(options: { payload: string }): Promise<void>
}

const TaskWidget = registerPlugin<TaskWidgetPlugin>('TaskWidget')

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
