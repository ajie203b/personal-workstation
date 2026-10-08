import { toggleDone, undoToggleDone } from '@/db/tasks'
import type { Task } from '@/db/db'
import { useUi } from '@/stores/ui'

/**
 * 勾选完成 / 恢复。完成会让任务消失（重复任务还会生成下一次），属于不可见变更，
 * 因此补一个撤销 toast；恢复方向任务会重新出现在列表里，不需要撤销。
 */
export async function toggleTaskWithUndo(task: Task): Promise<void> {
  if (task.status === 'done') {
    await toggleDone(task)
    return
  }
  const spawned = await toggleDone(task)
  useUi.getState().toast(`已完成「${shortTitle(task.title)}」`, {
    label: '撤销',
    run: () => void undoToggleDone(task, spawned),
  })
}

function shortTitle(title: string): string {
  const line = title.split('\n')[0].trim()
  return line.length > 14 ? `${line.slice(0, 14)}…` : line
}
