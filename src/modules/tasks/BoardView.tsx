import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { CalendarCheck, CalendarDays, Hourglass, Inbox, type LucideIcon } from 'lucide-react'
import { TIERS, TIER_LABEL, type Task, type Tier } from '@/db/db'
import { sortTasks } from '@/db/tasks'
import { moveTier } from '@/db/tasks'
import { TaskItem } from './TaskItem'
import { cn } from '@/lib/cn'

const TIER_ICON: Record<Tier, LucideIcon> = {
  today: CalendarCheck,
  upcoming: CalendarDays,
  anytime: Inbox,
  someday: Hourglass,
}

/** 同数据四视图之「看板」：按四清单分列，拖拽跨列移动（方案 2.1 增补） */
export function BoardView({ tasks }: { tasks: Task[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const byTier = useMemo(() => {
    const map = {} as Record<Tier, Task[]>
    for (const t of TIERS) map[t] = []
    for (const task of sortTasks(tasks.filter((t) => t.status !== 'done'))) map[task.tier].push(task)
    return map
  }, [tasks])

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const target = e.over?.id
    if (!target) return
    const id = String(e.active.id)
    const toTier = (TIERS as readonly string[]).includes(String(target))
      ? (String(target) as Tier)
      : tasks.find((t) => t.id === String(target))?.tier
    if (!toTier) return
    const from = tasks.find((t) => t.id === id)
    if (from && from.tier !== toTier) void moveTier(id, toTier)
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 enter">
        {TIERS.map((tier) => (
          <BoardColumn key={tier} tier={tier} tasks={byTier[tier]} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="rotate-1 scale-[1.02]">
            <TaskItem task={activeTask} overlay />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumn({ tier, tasks }: { tier: Tier; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: tier })
  const Icon = TIER_ICON[tier]
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-[16px] border p-2 min-h-[220px] transition-colors duration-150',
        isOver ? 'border-primary/60 bg-primary-soft/40' : 'border-outline bg-surface-2/50',
      )}
    >
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-3">
        <Icon size={15} className="text-on-surface-2" />
        <span className="text-[13px] font-semibold">{TIER_LABEL[tier]}</span>
        <span className="text-[11px] text-on-surface-2 bg-surface-3 px-1.5 py-0.5 rounded-full">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2 flex-1">
        {tasks.map((task) => (
          <DraggableCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <div className="grid place-items-center h-24 text-[12px] text-on-surface-2/70 border border-dashed border-outline rounded-xl">
            拖任务到这里
          </div>
        )}
      </div>
    </div>
  )
}

function DraggableCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn('dnd-item', isDragging && 'opacity-30')}>
      <TaskItem task={task} />
    </div>
  )
}
