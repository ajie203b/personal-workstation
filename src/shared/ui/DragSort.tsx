import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'
import { SORT_DURATION, SORT_EASING, SORT_TRANSITION } from '@/lib/sortMotion'
import { prefersReducedMotion } from '@/lib/motion'

const DragOverlayContext = createContext(false)
const DROP_DURATION = 220

/** 触摸长按后才起拖，普通滑动仍交给页面滚动。 */
export function DragSort({ ids, strategy, onMove, renderOverlay, children }: {
  ids: string[]
  strategy: SortingStrategy
  onMove: (activeId: string, overId: string) => void
  renderOverlay?: (activeId: string) => ReactNode
  children: ReactNode
}) {
  const suppressUntil = useRef(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dropTarget = useRef<{ id: string; rect: DOMRect } | null>(null)
  useLayoutEffect(() => {
    const pending = dropTarget.current
    if (!pending) return
    dropTarget.current = null
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-sortable]') ?? [])
      .find(item => item.dataset.sortable === pending.id)
    if (!target) return
    // 先测出重排后的真实位置；dnd-kit 可能仍带着上一帧的位移。
    const previousTransform = target.style.transform
    const previousTransition = target.style.transition
    target.style.transition = 'none'
    target.style.transform = 'none'
    const destination = target.getBoundingClientRect()
    target.style.transform = previousTransform
    target.style.transition = previousTransition
    if (prefersReducedMotion() || typeof target.animate !== 'function' || !destination.width || !destination.height) return
    const dx = pending.rect.left - destination.left
    const dy = pending.rect.top - destination.top
    const scaleX = pending.rect.width / destination.width
    const scaleY = pending.rect.height / destination.height
    const animation = target.animate(
      [{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
       { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1, 1)' }],
      { duration: DROP_DURATION, easing: SORT_EASING },
    )
    animation.finished.then(() => animation.cancel()).catch(() => {})
  }, [ids])
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
      onDragStart={({ active }) => { suppressUntil.current = Infinity; if (renderOverlay) setActiveId(String(active.id)); haptic('medium') }}
      onDragCancel={() => { suppressUntil.current = Date.now() + 350; if (renderOverlay) setActiveId(null) }}
      onDragEnd={({ active, over }) => {
        suppressUntil.current = Date.now() + 350
        if (renderOverlay) setActiveId(null)
        if (over && active.id !== over.id) {
          if (renderOverlay) {
            const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-sortable]') ?? [])
              .find(item => item.dataset.sortable === String(over.id))
            if (target) dropTarget.current = { id: String(over.id), rect: target.getBoundingClientRect() }
          }
          haptic('light'); onMove(String(active.id), String(over.id))
        }
      }}>
      <DragOverlayContext.Provider value={!!renderOverlay}>
        <SortableContext items={ids} strategy={strategy}>
        <div ref={listRef} className="contents" onPointerDownCapture={() => {
          // 新的一次按下属于用户的新操作；只吞掉拖动松手自带的 click。
          if (suppressUntil.current !== Infinity) suppressUntil.current = 0
        }} onClickCapture={e => {
          if (Date.now() < suppressUntil.current) { e.preventDefault(); e.stopPropagation() }
        }}>{children}</div>
        </SortableContext>
      </DragOverlayContext.Provider>
      {renderOverlay && typeof document !== 'undefined' && createPortal(
        <DragOverlay dropAnimation={{
          duration: prefersReducedMotion() ? 0 : DROP_DURATION,
          easing: SORT_EASING,
          // 网格中卡片高度可能不同，落位时尺寸也一起过渡，避免最后一帧突变。
          keyframes: ({ active, dragOverlay, transform }) => [
            { transform: CSS.Transform.toString(transform.initial), width: `${dragOverlay.rect.width}px`, height: `${dragOverlay.rect.height}px` },
            { transform: CSS.Transform.toString(transform.final), width: `${active.rect.width}px`, height: `${active.rect.height}px` },
          ],
        }} style={{ pointerEvents: 'none' }}>
          {activeId ? renderOverlay(activeId) : null}
        </DragOverlay>, document.body,
      )}
    </DndContext>
  )
}

export function DragSortItem({ id, children, className, label, as: Tag = 'div' }: {
  id: string; children: ReactNode; className?: string; label?: string; as?: 'li' | 'div'
}) {
  const hasOverlay = useContext(DragOverlayContext)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, transition: SORT_TRANSITION })
  const layoutTransition = hasOverlay ? (transition ?? 'transform 0ms') : `transform ${SORT_DURATION}ms ${SORT_EASING}`
  return (
    <Tag ref={setNodeRef} {...attributes} {...listeners} role={Tag === 'li' ? 'listitem' : label ? 'group' : undefined} aria-label={label}
      data-sortable={id} data-dragging={isDragging || undefined}
      onContextMenu={e => e.preventDefault()}
      className={cn(
        'relative select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-[14px]',
        'cursor-grab active:cursor-grabbing',
        isDragging && (hasOverlay ? 'opacity-0' : 'z-30 shadow-xl ring-1 ring-primary/15 cursor-grabbing'),
        className,
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        // 拖动中跟手不补间；落位与其它卡片换位用同一条缓出曲线，避免瞬移和弹簧过冲
        transition: isDragging
          ? 'scale 160ms var(--ease-soft-spring), rotate 160ms var(--ease-soft-spring), box-shadow 180ms var(--ease-standard)'
          : `${layoutTransition}, scale 160ms var(--ease-standard), rotate 160ms var(--ease-standard)`,
        scale: isDragging && !hasOverlay ? '1.025' : '1',
        rotate: isDragging && !hasOverlay ? '-0.4deg' : '0deg',
        willChange: isDragging ? 'transform' : undefined,
        WebkitTouchCallout: 'none',
      }}>
      {children}
    </Tag>
  )
}
