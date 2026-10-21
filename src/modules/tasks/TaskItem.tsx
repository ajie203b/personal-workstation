import { Clock, FileText, ListChecks, Pin, Repeat } from 'lucide-react'
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
        'card task-card card-hover relative px-4 py-3.5 cursor-pointer select-none',
        focused && 'ring-2 ring-primary/50',
        done && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 mt-0.5">
          <CheckCircle
            className="mt-0"
            checked={done}
            disabled={future}
            onChange={() => void toggleTaskWithUndo(task)}
            label={future ? '未来任务，到日期后再完成' : done ? '恢复任务' : '完成任务'}
          />
          {task.priority < 3 && (
            <span
              className="absolute -right-1 -top-0.5 w-[7px] h-[7px] rounded-full border border-surface pointer-events-none"
              style={{ background: PRIORITY_VAR[task.priority], opacity: done ? 0.45 : 1 }}
              title={task.priority === 0 ? '紧急' : task.priority === 1 ? '重要' : '普通'}
              role="img"
              aria-label={task.priority === 0 ? '紧急任务' : task.priority === 1 ? '重要任务' : '普通优先级'}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-ui-body font-medium leading-6 break-words transition-colors duration-150',
              done && 'line-through text-on-surface-2',
            )}
          >
            {task.title}
          </p>
          {(due || task.tags.length > 0 || task.repeat || task.docRef || task.status === 'doing') && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-1.5 text-ui-caption">
              {task.status === 'doing' && (
                <span className="inline-flex items-center gap-1.5 text-ok">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                  进行中
                </span>
              )}
              {due && (
                <span className={cn('inline-flex items-center gap-1', overdue ? 'text-danger font-medium' : 'text-on-surface-2')}>
                  <Clock size={14} aria-hidden />
                  {due.text}
                </span>
              )}
              {future && (
                <span className="inline-flex items-center text-p1">未来任务</span>
              )}
              {task.repeat && (
                <span className="inline-flex items-center gap-1 text-on-surface-2">
                  <Repeat size={14} aria-hidden />
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
                  className="inline-flex max-w-full min-w-0 items-center gap-1 text-primary hover:underline cursor-pointer"
                >
                  <FileText size={14} className="shrink-0" aria-hidden />
                  <span className="truncate">{task.docRef.label ?? '关联文档'}</span>
                </button>
              )}
              {task.tags.slice(0, 2).map((t) => (
                <span key={t} className="text-on-surface-2">
                  #{t}
                </span>
              ))}
              {task.tags.length > 2 && (
                <span className="text-on-surface-2" title={task.tags.slice(2).join('、')}>+{task.tags.length - 2}</span>
              )}
              {task.pinned && (
                <span className="inline-flex items-center gap-1 text-on-surface-2" title="已置顶">
                  <Pin size={14} aria-label="已置顶" />
                </span>
              )}
              {!!task.subtasks?.length && (
                <span className="inline-flex items-center gap-1 tabular-nums text-on-surface-2">
                  <ListChecks size={14} aria-hidden />
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
