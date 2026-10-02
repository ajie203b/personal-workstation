import { useEffect, useRef } from 'react'
import { Inbox } from 'lucide-react'
import type { Task } from '@/db/db'
import { useTasksUi } from '@/stores/tasks'
import { toggleDone } from '@/db/tasks'
import { TaskItem } from './TaskItem'
import { EmptyState } from '@/shared/ui/EmptyState'
import { cn } from '@/lib/cn'

interface Props {
  tasks: Task[]
  emptyTitle: string
  emptyHint?: string
  /** 键盘导航作用域 id，避免多列表互相抢焦点 */
  scope: string
}

/**
 * 列表视图 + 键盘流：
 * ↑↓/J K 移动选择，空格/X 勾选完成，Enter 打开详情。
 */
export function TaskList({ tasks, emptyTitle, emptyHint, scope }: Props) {
  const { focusId, setFocusId, openDetail } = useTasksUi()
  const containerRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!focusId) return
    document.getElementById(`task-${focusId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  useEffect(() => {
    // 列表内容变化后，聚焦项可能已不在列表中
    if (focusId && !tasks.some((t) => t.id === focusId)) setFocusId(null)
  }, [tasks, focusId, setFocusId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    if (e.nativeEvent.isComposing) return
    const idx = focusId ? tasks.findIndex((t) => t.id === focusId) : -1

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      setFocusId(tasks[Math.min(idx + 1, tasks.length - 1)]?.id ?? null)
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      setFocusId(tasks[Math.max(idx - 1, 0)]?.id ?? null)
    } else if ((e.key === ' ' || e.key === 'x') && idx >= 0) {
      e.preventDefault()
      void toggleDone(tasks[idx])
    } else if (e.key === 'Enter' && idx >= 0) {
      e.preventDefault()
      openDetail(tasks[idx].id)
    }
  }

  if (tasks.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} hint={emptyHint ?? '按 N 或 / 快速添加，例如「明天14:00 交报告 P1 #工作」'} />
  }

  return (
    <ul
      ref={containerRef}
      scope-data={scope}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      className={cn('flex flex-col gap-2 outline-none cascade enter')}
    >
      {tasks.map((t) => (
        <li key={t.id}>
          <TaskItem task={t} focused={focusId === t.id} />
        </li>
      ))}
    </ul>
  )
}
