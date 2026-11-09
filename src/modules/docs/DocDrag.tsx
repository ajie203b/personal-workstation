import { useId, useRef, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { createPortal } from 'react-dom'
import { FileText } from 'lucide-react'
import type { Doc } from '@/db/db'

export const TRASH_FOLDER = '__trash__'
export const UNFILED_FOLDER = '__unfiled__'

export function DocDragWorkspace({ docs, onDrop, children }: { docs: Doc[]; onDrop: (doc: Doc, target: string) => Promise<void>; children: ReactNode }) {
  const [active, setActive] = useState<Doc | null>(null)
  const suppressUntil = useRef(0)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 320, tolerance: 8 } }),
  )
  return <DndContext sensors={sensors} collisionDetection={pointerWithin}
    onDragStart={({ active }) => { suppressUntil.current = Infinity; setActive(docs.find(d => d.id === active.id) ?? null) }}
    onDragCancel={() => { suppressUntil.current = Date.now() + 350; setActive(null) }}
    onDragEnd={({ active, over }) => {
      suppressUntil.current = Date.now() + 350; setActive(null)
      const doc = docs.find(d => d.id === active.id)
      if (doc && over?.data.current?.target) void onDrop(doc, over.data.current.target)
    }}>
    <div className="contents" onClickCapture={e => { if (Date.now() < suppressUntil.current) { e.preventDefault(); e.stopPropagation() } }}>
      {children}
    </div>
    {createPortal(<DragOverlay dropAnimation={null}>{active && <div className="card flex items-center gap-3 p-4 shadow-lg max-w-80"><FileText size={24} /><span className="truncate">{active.title}</span></div>}</DragOverlay>, document.body)}
  </DndContext>
}

export function DocDragItem({ doc, children }: { doc: Doc; children: ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: doc.id })
  return <div ref={setNodeRef} {...listeners} role="group" data-draggable-doc={doc.id}
    aria-label={`拖动文档：${doc.title}，也可通过文档操作菜单移动`}
    className={isDragging ? 'opacity-35 select-none' : 'select-none'} style={{ WebkitTouchCallout: 'none' }}>
    {children}
  </div>
}

export function useDocDropTarget(id: string) {
  const instance = useId()
  return useDroppable({ id: `${id}-${instance}`, data: { target: id } })
}
