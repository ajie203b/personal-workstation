import { Clock, FileText, Flag, ListChecks, Pin, Repeat } from 'lucide-react'
import { PRIORITY_VAR, type Task } from '@/db/db'
import { fmtDue, isFutureTask } from '@/lib/date'
import { repeatLabel } from '@/lib/repeat'
import { cn } from '@/lib/cn'
import { CheckCircle } from '@/shared/ui/CheckCircle'
import { toggleTaskWithUndo } from './taskActions'
import { openDoc } from '@/shared/DeepLink'
import { useTasksUi } from '@/stores/tasks'
import { morphOpen } from '@/lib/viewTransition'

interface Props {
  task: Task
  /** 键盘流高亮 */
  focused?: boolean
  /** 看板拖拽态：隐藏交互控件 */
  overlay?: boolean
  /** 参与列表 FLIP 补位（只有列表视图的卡片需要） */
  flip?: boolean
}

export function TaskItem({ task, focused, overlay, flip }: Props) {
  const openDetail = useTasksUi((s) => s.openDetail)
  const done = task.status === 'done'
  const future = isFutureTask(task)
  const due = task.due ? fmtDue(task.due, task.dueTime) : null
  const overdue = due?.overdue && !done

  return (
    <div
      id={`task-${task.id}`}
      data-flip-id={flip ? `task-${task.id}` : undefined}
      aria-current={focused ? 'true' : undefined}
      // 共享元素转场：这张卡在旧快照里带转场名，详情容器在新快照里带同名，
      // 于是「卡片 → 详情」在空间上连续生长（不支持时自动退化为直接打开）
      onClick={overlay ? undefined : () => morphOpen(() => document.getElementById(`task-${task.id}`), () => openDetail(task.id))}
      className={cn(
        // 悬停/按压反馈统一由 .card-hover 的 transform + 描边承担，不再逐帧改阴影
        'card card-hover relative px-4 py-3 cursor-pointer select-none',
        focused && 'ring-2 ring-primary/50',
        done && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <CheckCircle
          checked={done}
          disabled={future}
          onChange={() => void toggleTaskWithUndo(task)}
          label={future ? '未来任务，到日期后再完成' : done ? '恢复任务' : '完成任务'}
        />
        {/* macOS 提醒事项式优先级圆点：取代整卡彩色描边，克制不吵 */}
        {task.priority < 3 && (
          <span
            className="mt-2 w-2 h-2 rounded-full shrink-0"
            style={{ background: PRIORITY_VAR[task.priority], opacity: done ? 0.45 : 1 }}
            title={task.priority === 0 ? '紧急' : task.priority === 1 ? '重要' : '普通'}
            aria-hidden
          />
        )}

        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[15px] leading-6 break-words transition-colors duration-150',
              done && 'line-through text-on-surface-2',
            )}
          >
            {task.title}
          </p>
          {(due || task.tags.length > 0 || task.repeat || task.docRef || task.status === 'doing') && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              {task.status === 'doing' && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ok">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok animate-ai-pulse" />
                  进行中
                </span>
              )}
              {due && (
                <span className={cn('inline-flex items-center gap-1 text-[12px]', overdue ? 'text-danger font-medium' : 'text-on-surface-2')}>
                  <Clock size={12} />
                  {due.text}
                </span>
              )}
              {future && (
                <span className="inline-flex items-center text-[11px] text-p1">未来任务</span>
              )}
              {task.repeat && (
                <span className="inline-flex items-center gap-1 text-[12px] text-on-surface-2">
                  <Repeat size={12} />
                  {repeatLabel(task.repeat, { days: task.repeatDays, monthDay: task.repeatMonthDay })}
                </span>
              )}
              {task.docRef && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openDoc(task.docRef!)
                  }}
                  title="打开关联文档"
                  className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline cursor-pointer"
                >
                  <FileText size={12} />
                  {task.docRef.label ?? '关联文档'}
                </button>
              )}
              {task.tags.map((t) => (
                <span key={t} className="text-[12px] text-on-surface-2">
                  #{t}
                </span>
              ))}
              {(task.priority === 0 || task.priority === 1) && !done && (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: PRIORITY_VAR[task.priority] }}>
                  <Flag size={12} />
                  {task.priority === 0 ? '紧急' : '重要'}
                </span>
              )}
              {task.pinned && (
                <span className="inline-flex items-center gap-1 text-[12px] text-primary" title="已置顶">
                  <Pin size={12} />
                </span>
              )}
              {!!task.subtasks?.length && (
                <span className="inline-flex items-center gap-1 text-[12px] tabular-nums text-on-surface-2">
                  <ListChecks size={12} />
                  {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
