import { checkinProgress, checkInTask, deleteTask, restoreTask, toggleDone, undoToggleDone, updateTask } from '@/db/tasks'
import { db, type Task } from '@/db/db'
import { useUi } from '@/stores/ui'
import { registerUndo } from '@/lib/undo'
import { isFutureTask, todayStr } from '@/lib/date'
import { burstFromTask } from '@/lib/celebrate'
import { disintegrate } from '@/lib/disintegrate'

/**
 * 小组件勾选（com.personal.workstation://complete?id=）的落地：
 * 与列表勾选同一套语义——重复任务打卡、普通任务完成，未来任务拦下并提示。
 * 小组件那边只带 id，任务状态要现取，别拿快照里的旧数据。
 */
export async function completeById(id: string): Promise<void> {
  const task = await db.tasks.get(id)
  if (!task) {
    useUi.getState().toast('这条任务已经不在了')
    return
  }
  if (task.status === 'done') {
    useUi.getState().toast('这条任务已经完成了')
    return
  }
  if (task.repeat) await checkInWithUndo(task)
  else await toggleTaskWithUndo(task)
}

/**
 * 勾选完成 / 恢复。完成会让任务消失（重复任务还会生成下一次），属于不可见变更，
 * 因此补一个撤销 toast，并登记给全局 ⌘/Ctrl+Z；两条路径共用同一闭包，once 防重复撤销。
 * 恢复方向任务会重新出现在列表里，不需要撤销。
 */
export async function toggleTaskWithUndo(task: Task): Promise<void> {
  if (task.status !== 'done' && isFutureTask(task)) {
    useUi.getState().toast('这是未来任务，到日期后再完成')
    return
  }
  if (task.status === 'done') {
    await toggleDone(task)
    return
  }
  // 从勾选圈原位撒花；等数据落库后卡片就要移除了，必须先把坐标取走
  burstFromTask(task.id)
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

/**
 * 打卡任务专用：一次点击 = 打一次卡。
 * 次数没打满只 +1 并留在列表里（显示 2/3），打满才归档并生成下一次；
 * 撤销时把计数一起退回去，避免恢复后直接算满。
 */
export async function checkInWithUndo(task: Task): Promise<void> {
  if (task.status !== 'done' && isFutureTask(task)) {
    useUi.getState().toast('这是未来任务，到日期后再打')
    return
  }
  if (task.status === 'done') {
    await toggleDone(task)
    return
  }
  const progress = checkinProgress(task)
  const before = progress.count
  // 只有打满归档的那一次才撒花；中途 +1 用勾选圈自己的按压反馈
  if (before + 1 >= progress.total) burstFromTask(task.id)
  const result = await checkInTask(task)
  if (!result.completed) {
    useUi.getState().toast(`已打卡 ${result.count}/${result.total}`)
    return
  }
  let used = false
  const undoOnce = () => {
    if (used) return
    used = true
    void undoToggleDone(task, result.spawned).then(() =>
      updateTask(task.id, {
        checkin: { due: task.due ?? todayStr(), count: before, at: Date.now() },
      }),
    )
  }
  useUi.getState().toast(
    result.total > 1 ? `已打满 ${result.total} 次，归档` : `已完成「${shortTitle(task.title)}」`,
    { label: '撤销', run: undoOnce },
  )
  registerUndo(`打卡「${shortTitle(task.title)}」`, undoOnce)
}

/**
 * 删除 + 6 秒撤销：列表左滑和详情删除共用同一条路径，避免两处文案/墓碑处理分叉。
 * source 是触发删除的卡片：传了就先在原位打散成沙，数据照常立即删除。
 */
export async function deleteTaskWithUndo(task: Task, source?: HTMLElement | null, offsetX?: number): Promise<void> {
  disintegrate(source, { offsetX })
  await deleteTask(task)
  let used = false
  const undoOnce = () => {
    if (used) return
    used = true
    void restoreTask(task)
  }
  useUi.getState().toast('已删除任务', { label: '撤销', run: undoOnce })
  registerUndo(`删除「${shortTitle(task.title)}」`, undoOnce)
}

function shortTitle(title: string): string {
  const line = title.split('\n')[0].trim()
  return line.length > 14 ? `${line.slice(0, 14)}…` : line
}
