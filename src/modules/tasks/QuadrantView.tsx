import { useMemo } from 'react'
import { Flame, AlertTriangle, CalendarClock, Archive } from 'lucide-react'
import type { Task } from '@/db/db'
import { sortTasks } from '@/db/tasks'
import { daysFromToday } from '@/lib/date'
import { cn } from '@/lib/cn'

interface Props {
  tasks: Task[]
  onOpenTask: (id: string) => void
}

type Quadrant = 'q1' | 'q2' | 'q3' | 'q4'

interface QuadMeta {
  key: Quadrant
  label: string
  desc: string
  icon: typeof Flame
  color: string
}

const QUADS: QuadMeta[] = [
  { key: 'q1', label: '立即做', desc: '紧急 + 重要', icon: Flame, color: 'var(--p0)' },
  { key: 'q2', label: '计划做', desc: '重要 · 不紧急', icon: CalendarClock, color: 'var(--p2)' },
  { key: 'q3', label: '委托/简化', desc: '紧急 · 不重要', icon: AlertTriangle, color: 'var(--p1)' },
  { key: 'q4', label: '减少做', desc: '不紧急 · 不重要', icon: Archive, color: 'var(--p3)' },
]

function classify(task: Task): Quadrant {
  const important = task.priority <= 1 // P0/P1
  const due = task.due ?? ''
  const urgent = due ? daysFromToday(due) <= 7 : false // 含逾期
  if (important && urgent) return 'q1'
  if (important && !urgent) return 'q2'
  if (!important && urgent) return 'q3'
  return 'q4'
}

/** 四象限视图（v1.2）：重要 × 紧急 2×2 矩阵，点击标签手动改判 */
export function QuadrantView({ tasks, onOpenTask }: Props) {

  const quadrants = useMemo(() => {
    const active = tasks.filter((t) => t.status !== 'done')
    const map: Record<Quadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] }
    for (const t of active) map[classify(t)].push(t)
    // 每象限内排序
    for (const key of Object.keys(map) as Quadrant[]) map[key] = sortTasks(map[key])
    return map
  }, [tasks])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
      {QUADS.map((q) => (
        <div key={q.key} className="card p-3.5 flex flex-col gap-2.5 min-h-[200px]">
          <div className="flex items-center gap-2">
            <q.icon size={16} style={{ color: q.color }} />
            <span className="text-[13.5px] font-semibold">{q.label}</span>
            <span className="text-[11px] text-on-surface-2">{q.desc}</span>
            <span className="ml-auto text-[11px] text-on-surface-2 tabular-nums">{quadrants[q.key].length}</span>
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            {quadrants[q.key].length === 0 && (
              <p className="text-[11.5px] text-on-surface-2/60 py-3 text-center">暂无任务</p>
            )}
            {quadrants[q.key].map((t) => (
              <TaskQuadItem key={t.id} task={t} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TaskQuadItem({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const quad = classify(task)
  const overdue = task.due ? daysFromToday(task.due) < 0 : false
  return (
    <div
      onClick={() => onOpen(task.id)}
      className="px-2.5 py-2 rounded-[8px] bg-surface border border-outline/50 cursor-pointer hover:border-primary/40 transition-colors select-none"
    >
      <div className="flex items-start gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
          style={{ background: task.priority === 0 ? 'var(--p0)' : task.priority === 1 ? 'var(--p1)' : task.priority === 2 ? 'var(--p2)' : 'var(--p3)' }}
        />
        <span className={cn('flex-1 text-[13px] leading-snug', task.status === 'done' && 'line-through text-on-surface-2')}>
          {task.title}
        </span>
        {/* 手动改判：点击移动到下一象限 */}
        <button
          aria-label={`移动象限（当前${quad}）`}
          onClick={(e) => {
            e.stopPropagation()
            // 切换优先级以移动象限
            const nextPriority: Record<Quadrant, 0 | 1 | 2 | 3> = { q1: 2, q2: 0, q3: 3, q4: 1 }
            void import('@/db/tasks').then(({ updateTask }) => void updateTask(task.id, { priority: nextPriority[quad] }))
          }}
          className="text-[10px] text-on-surface-2 hover:text-primary cursor-pointer shrink-0 mt-0.5"
          title="移动象限"
        >
          ⇄
        </button>
      </div>
      {task.due && (
        <span className={cn('text-[10.5px] mt-0.5 inline-block', overdue ? 'text-danger font-medium' : 'text-on-surface-2')}>
          {task.due}
        </span>
      )}
    </div>
  )
}
