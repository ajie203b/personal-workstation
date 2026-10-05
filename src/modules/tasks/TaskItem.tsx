import { Clock, FileText, Flag, MoreHorizontal, Repeat } from 'lucide-react'
import { PRIORITY_VAR, TIER_LABEL, type Task } from '@/db/db'
import { fmtDue } from '@/lib/date'
import { cn } from '@/lib/cn'
import { CheckCircle } from '@/shared/ui/CheckCircle'
import {
  DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator,
} from '@/shared/ui/Menu'
import { toggleDone, moveTier, setPriority, updateTask, deleteTask, restoreTask } from '@/db/tasks'
import { openDoc } from '@/shared/DeepLink'
import { useTasksUi } from '@/stores/tasks'
import { useUi } from '@/stores/ui'
import { TIERS } from '@/db/db'

interface Props {
  task: Task
  /** 键盘流高亮 */
  focused?: boolean
  /** 看板拖拽态：隐藏交互控件 */
  overlay?: boolean
}

export function TaskItem({ task, focused, overlay }: Props) {
  const openDetail = useTasksUi((s) => s.openDetail)
  const toast = useUi((s) => s.toast)
  const done = task.status === 'done'
  const due = task.due ? fmtDue(task.due, task.dueTime) : null
  const overdue = due?.overdue && !done

  const remove = () => {
    void deleteTask(task).then(() => {
      toast('已删除任务', { label: '撤销', run: () => void restoreTask(task) })
    })
  }

  // 点击分区：左半边 = 完成/恢复；右半区 = 打开详情
  const onCardClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const onLeft = e.clientX - rect.left < rect.width / 2
    if (onLeft) void toggleDone(task)
    else openDetail(task.id)
  }

  return (
    <div
      id={`task-${task.id}`}
      onClick={overlay ? undefined : onCardClick}
      className={cn(
        'card card-hover relative px-4 py-3 cursor-pointer select-none',
        'transition-shadow duration-150',
        focused && 'ring-2 ring-primary/50',
        done && 'opacity-60',
      )}
      // 优先级闭合边框：整卡外轮廓按红→橙黄→蓝→灰包裹，一眼识别档次
      style={{
        borderColor: PRIORITY_VAR[task.priority],
        borderWidth: task.priority === 3 ? 1 : 1.5,
        borderStyle: 'solid',
      }}
    >
      <div className="flex items-start gap-3">
        <CheckCircle checked={done} onChange={() => void toggleDone(task)} label={done ? '恢复任务' : '完成任务'} />

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
              {task.repeat && (
                <span className="inline-flex items-center gap-1 text-[12px] text-on-surface-2">
                  <Repeat size={12} />
                  {{ daily: '每天', weekly: '每周', weekdays: '工作日' }[task.repeat]}
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
            </div>
          )}
        </div>

        {!overlay && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="任务操作"
                onClick={(e) => e.stopPropagation()}
                className="grid place-items-center w-8 h-8 -mr-1.5 rounded-lg text-on-surface-2/70 hover:bg-surface-3 hover:text-on-surface transition-colors"
              >
                <MoreHorizontal size={17} />
              </button>
            </DropdownMenuTrigger>
            <MenuContent>
              {task.status !== 'done' && (
                <MenuItem
                  active={task.status === 'doing'}
                  onSelect={() => void updateTask(task.id, { status: task.status === 'doing' ? 'todo' : 'doing' })}
                >
                  <span className={cn('w-2 h-2 rounded-full bg-ok', task.status === 'doing' && 'animate-ai-pulse')} />
                  {task.status === 'doing' ? '停止进行中' : '标记进行中'}
                </MenuItem>
              )}
              <MenuLabel>优先级</MenuLabel>
              {([0, 1, 2, 3] as const).map((p) => (
                <MenuItem key={p} active={task.priority === p} onSelect={() => void setPriority(task.id, p)}>
                  <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_VAR[p] }} />
                  {['P0 紧急', 'P1 重要', 'P2 常规', 'P3 低'][p]}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuLabel>移至清单</MenuLabel>
              {TIERS.map((t) => (
                <MenuItem key={t} active={task.tier === t} onSelect={() => void moveTier(task.id, t)}>
                  {TIER_LABEL[t]}
                </MenuItem>
              ))}
              <MenuSeparator />
              {task.status !== 'done' && (
                <MenuItem onSelect={() => void toggleDone(task)}>✓ 标记完成</MenuItem>
              )}
              <MenuItem danger onSelect={remove}>删除任务</MenuItem>
            </MenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
