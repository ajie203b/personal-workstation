import { toggleDone, undoToggleDone } from '@/db/tasks'
import type { Task } from '@/db/db'
import { useUi } from '@/stores/ui'
import { registerUndo } from '@/lib/undo'

/**
 * 勾选完成 / 恢复。完成会让任务消失（重复任务还会生成下一次），属于不可见变更，
 * 因此补一个撤销 toast，并登记给全局 ⌘/Ctrl+Z；两条路径共用同一闭包，once 防重复撤销。
 * 恢复方向任务会重新出现在列表里，不需要撤销。
 */
export async function toggleTaskWithUndo(task: Task): Promise<void> {
  if (task.status === 'done') {
    await toggleDone(task)
    return
  }
  const spawned = await toggleDone(task)
  let used = false
  const undoOnce = () => {
    if (used) return
    used = true
    void undoToggleDone(task, spawned)
  }
  useUi.getState().toast(`已完成「${shortTitle(task.title)}」`, {
    label: '撤销',
    run: undoOnce,
  })
  registerUndo(`完成「${shortTitle(task.title)}」`, undoOnce)
}

function shortTitle(title: string): string {
  const line = title.split('\n')[0].trim()
  return line.length > 14 ? `${line.slice(0, 14)}…` : line
}
