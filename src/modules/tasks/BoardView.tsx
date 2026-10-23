import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable,
  closestCorners, pointerWithin, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarCheck, CalendarDays, Hourglass, Inbox, GripVertical, type LucideIcon } from 'lucide-react'
import { TIERS, TIER_LABEL, type Task, type Tier } from '@/db/db'
import { sortTasks } from '@/db/tasks'
import { moveTier, reorderTasks } from '@/db/tasks'
import { useUi } from '@/stores/ui'
import { TaskItem } from './TaskItem'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'

const TIER_ICON: Record<Tier, LucideIcon> = {
  today: CalendarCheck,
  upcoming: CalendarDays,
  anytime: Inbox,
  someday: Hourglass,
}

/**
 * 拖拽中的碰撞策略：指针明确落在某一列内时用「列内最近卡片」，
 * 否则退回「四角最近」——纯 closestCorners 在跨列时会被相邻列的卡片抢走落点。
 */
const collision: CollisionDetection = (args) => {
  const inColumn = pointerWithin(args)
  if (inColumn.length) return inColumn
  return closestCorners(args)
}

/** 同数据四视图之「看板」：按四清单分列，长按拖拽跨列移动 + 列内 FLIP 补位 */
export function BoardView({ tasks }: { tasks: Task[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  // 桌面按下拖动 6px 起拖；移动端长按 200ms 起拖——轻点仍是「打开详情」，滑动仍能滚页
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const byTier = useMemo(() => {
    const map = {} as Record<Tier, Task[]>
    for (const t of TIERS) map[t] = []
    for (const task of sortTasks(tasks.filter((t) => t.status !== 'done'))) map[task.tier].push(task)
    return map
  }, [tasks])

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
    haptic('medium')
  }

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
    if (from && from.tier !== toTier) {
      haptic('light')
      void moveTier(id, toTier)
    } else if (from && String(target) !== toTier) {
      void reorderTasks(byTier[toTier].map(t => t.id), id, String(target))
        .catch(() => useUi.getState().toast('排序保存失败，请重试'))
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* 窄屏一列一屏左右滑（吸附），到 sm 才铺成 2 列 / xl 4 列 */}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-3 -mx-4 px-4 md:mx-0 md:px-0 enter">
        {TIERS.map((tier) => (
          <div key={tier} className="snap-start shrink-0 w-[86vw] sm:w-[280px] md:flex-1 md:min-w-[260px]">
            <BoardColumn tier={tier} tasks={byTier[tier]} />
          </div>
        ))}
      </div>
      <DragOverlay>
        {activeTask && (
          <div className="drop-settle rotate-[0.6deg] scale-[1.02] drop-shadow-lg">
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
        // 只过渡 transform / 边框 / 背景，避免 transition-all 连带阴影逐帧重算
        'flex flex-col rounded-[16px] border p-2 min-h-[220px] transition-[transform,border-color,background-color] duration-150 ease-standard',
        isOver ? 'border-primary/60 bg-primary-soft/40 scale-[1.004]' : 'border-outline bg-surface-2/50',
      )}
    >
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-3">
        <Icon size={15} className="text-on-surface-2" />
        <span className="text-[13px] font-semibold">{TIER_LABEL[tier]}</span>
        <span className="text-[11px] text-on-surface-2 bg-surface-3 px-1.5 py-0.5 rounded-full">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
      {tasks.length === 0 && (
        <div className="grid place-items-center flex-1 min-h-[96px] px-3 text-center text-[12px] text-on-surface-2 border border-dashed border-outline rounded-xl">
          拖任务到这里，或用上方输入框 / 右下角加号添加
        </div>
      )}
    </div>
  )
}

/** sortable 卡片自带 droppable，所以落点可能是别的卡片 id；列容器另外注册成整列落点兜底 */
function SortableCard({ task }: { task: Task }) {
  // 落位/让位用弹簧缓动，落点不再是硬贴（P1 看板落位回弹）
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    transition: { duration: 300, easing: 'cubic-bezier(.34, 1.32, .5, 1)' },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group relative', isDragging && 'opacity-30')}
      data-dragging={isDragging ? 'true' : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskItem task={task} />
      {/* 桌面端的显式可拖提示；手势本身在整张卡上，长按 200ms 才起拖 */}
      <span
        aria-hidden
        className="absolute right-9 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-8 text-on-surface-2/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity"
      >
        <GripVertical size={14} />
      </span>
    </div>
  )
}
