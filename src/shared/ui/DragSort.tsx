import { useEffect, useRef, type ReactNode } from 'react'
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'

/** 触摸长按后才起拖，普通滑动仍交给页面滚动。 */
export function DragSort({ ids, strategy, onMove, children }: {
  ids: string[]
  strategy: SortingStrategy
  onMove: (activeId: string, overId: string) => void
  children: ReactNode
}) {
  const suppressUntil = useRef(0)
  // 拖拽松手后浏览器仍会补一个 click；在 document 捕获阶段吞掉，桌面端才不会「拖完就进工具」。
  useEffect(() => {
    const swallow = (e: MouseEvent) => {
      if (Date.now() < suppressUntil.current) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', swallow, true)
    return () => document.removeEventListener('click', swallow, true)
  }, [])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 320, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: '长按后拖动排序。键盘按空格提起，方向键移动，再按空格放下，Escape 取消。' } }}
      onDragStart={() => { suppressUntil.current = Infinity; haptic('medium') }}
      onDragCancel={() => { suppressUntil.current = Date.now() + 350 }}
      onDragEnd={({ active, over }) => {
        suppressUntil.current = Date.now() + 350
        if (over && active.id !== over.id) { haptic('light'); onMove(String(active.id), String(over.id)) }
      }}>
      <SortableContext items={ids} strategy={strategy}>
        <div className="contents" onPointerDownCapture={() => {
          // 新的一次按下属于用户的新操作；只吞掉拖动松手自带的 click。
          if (suppressUntil.current !== Infinity) suppressUntil.current = 0
        }} onClickCapture={e => {
          if (Date.now() < suppressUntil.current) { e.preventDefault(); e.stopPropagation() }
        }}>{children}</div>
      </SortableContext>
    </DndContext>
  )
}

export function DragSortItem({ id, children, className, as: Tag = 'div' }: {
  id: string; children: ReactNode; className?: string; as?: 'li' | 'div'
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id })
  return (
    <Tag ref={setNodeRef} {...attributes} {...listeners} role={Tag === 'li' ? 'listitem' : undefined}
      data-sortable={id} data-dragging={isDragging || undefined}
      onContextMenu={e => e.preventDefault()}
      className={cn(
        'relative select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-[14px]',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'z-30 shadow-xl ring-1 ring-primary/15 cursor-grabbing',
        className,
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        // 拖动中跟手不补间；落位与其它卡片换位用同一条缓出曲线，避免瞬移和弹簧过冲
        transition: isDragging
          ? 'scale 160ms var(--ease-soft-spring), rotate 160ms var(--ease-soft-spring), box-shadow 180ms var(--ease-standard)'
          : 'transform 250ms cubic-bezier(.22,.8,.36,1), scale 160ms var(--ease-standard), rotate 160ms var(--ease-standard)',
        scale: isDragging ? '1.025' : '1',
        rotate: isDragging ? '-0.4deg' : '0deg',
        willChange: isDragging ? 'transform' : undefined,
        WebkitTouchCallout: 'none',
      }}>
      {children}
    </Tag>
  )
}
