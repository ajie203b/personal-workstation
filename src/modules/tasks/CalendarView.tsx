import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, GripVertical, Inbox } from 'lucide-react'
import type { Task } from '@/db/db'
import { TIERS, TIER_LABEL } from '@/db/db'
import { sortTasks, updateTask } from '@/db/tasks'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'

interface Props {
  tasks: Task[]
  onOpenTask: (id: string) => void
  onToggleDone: (task: Task) => void
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 日历视图（v1.2 → v1.3 拖拽排期）：月视图网格 + 议程流 + 未排期池拖入日期即排期 */
export function CalendarView({ tasks, onOpenTask, onToggleDone }: Props) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth()) // 0-11
  const [selectedDate, setSelectedDate] = useState<string | null>(toDateKey(today))
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const toast = useUi((s) => s.toast)

  // 按到期日分组
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.status === 'done' || !t.due) continue
      const list = map.get(t.due) ?? []
      list.push(t)
      map.set(t.due, list)
    }
    return map
  }, [tasks])

  // 未排期池：随时/将来清单里没有日期的任务
  const unscheduled = useMemo(
    () =>
      sortTasks(
        tasks.filter((t) => t.status !== 'done' && !t.due && (t.tier === 'anytime' || t.tier === 'someday')),
      ).slice(0, 30),
    [tasks],
  )

  // 当月日历网格（含前后月补位）
  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startDow = (first.getDay() + 6) % 7 // 周一=0
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: { date: Date; inMonth: boolean }[] = []
    // 前月补位
    for (let i = startDow - 1; i >= 0; i--) {
      cells.push({ date: new Date(viewYear, viewMonth, -i), inMonth: false })
    }
    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(viewYear, viewMonth, d), inMonth: true })
    }
    // 后月补位（填满 6 行）
    while (cells.length % 7 !== 0 || cells.length < 42) {
      cells.push({ date: new Date(viewYear, viewMonth + 1, cells.length - startDow - daysInMonth + 1), inMonth: false })
    }
    return cells.slice(0, 42)
  }, [viewYear, viewMonth])

  // 议程流：选中日期或「全部即将到来」
  const agenda = useMemo(() => {
    const todayKey = toDateKey(today)
    const upcoming = tasks
      .filter((t) => t.status !== 'done' && t.due && t.due >= todayKey)
      .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
    if (selectedDate) {
      return sortTasks(byDate.get(selectedDate) ?? [])
    }
    return sortTasks(upcoming)
  }, [tasks, selectedDate, byDate])

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11) } else setViewMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0) } else setViewMonth((m) => m + 1)
  }
  const goToday = () => {
    setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelectedDate(toDateKey(today))
  }

  /** 拖放排期：拖任务到日期格 = 设置 due 并归入对应清单 */
  const scheduleTo = (taskId: string, dateKey: string) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    const tier = dateKey <= toDateKey(today) ? 'today' : 'upcoming'
    void updateTask(taskId, { due: dateKey, tier, dueTime: task.dueTime })
    toast(`已排到 ${dateKey}${dateKey <= toDateKey(today) ? '（今日）' : ''}`)
  }

  const onCellDrop = (e: React.DragEvent, dateKey: string) => {
    e.preventDefault()
    setDragOverKey(null)
    const taskId = e.dataTransfer.getData('text/task-id')
    if (taskId) scheduleTo(taskId, dateKey)
  }

  const monthLabel = `${viewYear} 年 ${viewMonth + 1} 月`
  const todayKey = toDateKey(today)

  return (
    <div className="flex flex-col gap-4">
      {/* 月历导航 */}
      <div className="flex items-center gap-2">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-surface-3 cursor-pointer text-on-surface-2">
          <ChevronLeft size={18} />
        </button>
        <span className="text-[15px] font-semibold min-w-[120px] text-center">{monthLabel}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-surface-3 cursor-pointer text-on-surface-2">
          <ChevronRight size={18} />
        </button>
        <button onClick={goToday} className="ml-auto text-[12px] px-2.5 py-1 rounded-full bg-surface-3 hover:bg-surface-3/70 text-on-surface-2 cursor-pointer">
          今天
        </button>
      </div>

      {/* 星期标题 */}
      <div className="grid grid-cols-7 text-center text-[11px] text-on-surface-2">
        {WEEK_LABELS.map((w) => <span key={w} className="py-1">{w}</span>)}
      </div>

      {/* 日历网格（接受拖放排期） */}
      <div className="grid grid-cols-7 gap-px bg-outline/40 rounded-[10px] overflow-hidden">
        {grid.map((cell, i) => {
          const key = toDateKey(cell.date)
          const dayTasks = byDate.get(key) ?? []
          const isToday = key === todayKey
          const isSelected = key === selectedDate
          const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(key)}
              onDragOver={(e) => { e.preventDefault(); setDragOverKey(key) }}
              onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
              onDrop={(e) => onCellDrop(e, key)}
              className={cn(
                'min-h-[64px] p-1.5 text-left bg-surface transition-colors cursor-pointer',
                !cell.inMonth && 'opacity-30',
                dragOverKey === key ? 'bg-primary-soft ring-2 ring-primary/60' : isSelected ? 'bg-primary-soft ring-1 ring-primary/50' : 'hover:bg-surface-2',
              )}
            >
              <span className={cn(
                'text-[12px] font-medium inline-grid place-items-center w-5 h-5 rounded-full',
                isToday ? 'bg-primary text-on-primary' : isWeekend && cell.inMonth ? 'text-danger/70' : '',
              )}>
                {cell.date.getDate()}
              </span>
              {dayTasks.length > 0 && (
                <>
                  {/* 小屏：圆点计数 */}
                  <div className="mt-1 flex sm:hidden items-center gap-0.5 pl-0.5">
                    {dayTasks.slice(0, 4).map((t) => (
                      <span
                        key={t.id}
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: t.priority === 0 ? 'var(--p0)' : t.priority === 1 ? 'var(--p1)' : t.priority === 2 ? 'var(--p2)' : 'var(--p3)' }}
                      />
                    ))}
                    {dayTasks.length > 4 && <span className="text-[8px] text-on-surface-2">+{dayTasks.length - 4}</span>}
                  </div>
                  {/* 大屏：文本条 */}
                  <div className="mt-0.5 hidden sm:flex flex-col gap-0.5">
                    {dayTasks.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/task-id', t.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'text-[9px] leading-tight truncate px-0.5 rounded-sm cursor-grab active:cursor-grabbing',
                          t.priority === 0 ? 'text-p0 font-medium' : t.priority === 1 ? 'text-p1' : 'text-on-surface-2',
                        )}
                      >
                        {t.title}
                      </span>
                    ))}
                    {dayTasks.length > 3 && <span className="text-[9px] text-on-surface-2">+{dayTasks.length - 3}</span>}
                  </div>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* 议程流 */}
      <div>
        <h3 className="text-[13px] font-semibold text-on-surface-2 mb-2 px-1">
          {selectedDate ? `${selectedDate} 的任务` : '即将到来'}
        </h3>
        {agenda.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-on-surface-2">
            <Inbox size={24} className="mb-2 opacity-50" />
            <p className="text-[13px]">没有待办任务</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {agenda.map((t) => (
              <button
                key={t.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/task-id', t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => onOpenTask(t.id)}
                className="card card-hover px-3.5 py-2.5 flex items-center gap-2.5 text-left cursor-grab active:cursor-grabbing w-full"
              >
                <span
                  className="w-1 h-8 rounded-full shrink-0"
                  style={{ background: t.priority === 0 ? 'var(--p0)' : t.priority === 1 ? 'var(--p1)' : t.priority === 2 ? 'var(--p2)' : 'var(--p3)' }}
                />
                <span className="flex-1 min-w-0">
                  <span className={cn('block text-[13.5px] truncate', t.status === 'done' && 'line-through text-on-surface-2')}>{t.title}</span>
                  {t.due && <span className="text-[11px] text-on-surface-2">{t.due}</span>}
                </span>
                {t.status !== 'done' && (
                  <button
                    aria-label="完成任务"
                    onClick={(e) => { e.stopPropagation(); onToggleDone(t) }}
                    className="shrink-0 w-6 h-6 rounded-full border-[1.5px] border-on-surface-2/40 hover:border-primary grid place-items-center cursor-pointer"
                  />
                )}
              </button>
            ))}
            <p className="text-[11px] text-on-surface-2/70 px-1">提示：按住任务拖到上方日期格，可直接改期</p>
          </div>
        )}
      </div>

      {/* 未排期池：拖到日历即排期 */}
      {unscheduled.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-on-surface-2 mb-2 px-1">未排期（拖到上方日期安排时间）</h3>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((t) => (
              <span
                key={t.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/task-id', t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-surface-2 border border-outline text-[12.5px] cursor-grab active:cursor-grabbing select-none hover:border-primary/50 transition-colors"
                title={`${TIER_LABEL[t.tier as typeof TIERS[number]]} · 拖到日期格排期`}
              >
                <GripVertical size={12} className="text-on-surface-2/60" />
                {t.title.slice(0, 18)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
