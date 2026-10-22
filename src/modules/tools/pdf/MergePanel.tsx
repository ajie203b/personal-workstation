import { useState } from 'react'
import {
  DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileText, GripVertical, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/id'
import { mergePdfs } from './pdfOps'
import { yieldToUi, type ToolOutput } from './output'
import { Field, FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'

interface Item {
  id: string
  file: File
}

/** 合并：多 PDF 拖拽排序 → 按顺序拼成一份 */
export function MergePanel() {
  const [items, setItems] = useState<Item[]>([])
  const [name, setName] = useState('合并')
  // 桌面按下拖 6px 起拖、手机长按 200ms 起拖：轻点仍是删除按钮，滑动仍能滚页
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id
    if (!overId) return
    const from = items.findIndex((i) => i.id === e.active.id)
    const to = items.findIndex((i) => i.id === overId)
    if (from < 0 || to < 0 || from === to) return
    haptic('light')
    setItems((list) => arrayMove(list, from, to))
  }

  const make = async (): Promise<ToolOutput> => {
    if (items.length < 2) throw new Error('至少选两个 PDF 才能合并')
    const sources: Uint8Array[] = []
    for (const it of items) {
      sources.push(await fileBytes(it.file))
      await yieldToUi()
    }
    const bytes = await mergePdfs(sources)
    return { blob: pdfBlob(bytes), filename: `${name.trim() || '合并'}.pdf`, isPdf: true }
  }

  return (
    <Panel title="合并 PDF" desc="多个 PDF 按列表顺序拼成一份，长按拖动手柄可调顺序。">
      <FilePicker
        accept="application/pdf"
        multiple
        label="添加 PDF"
        hint="可一次选多个"
        onPick={(files) =>
          setItems((list) => [...list, ...files.map((file) => ({ id: uid(), file }))])
        }
      />

      {items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {items.map((it, index) => (
                <MergeRow
                  key={it.id}
                  item={it}
                  index={index}
                  onRemove={() => setItems((list) => list.filter((i) => i.id !== it.id))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="合并"
          className="w-40 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
        />
      </Field>

      <OutputBar make={make} action="合并" disabled={items.length < 2} />
    </Panel>
  )
}

function MergeRow({ item, index, onRemove }: { item: Item; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-2 py-2',
        isDragging && 'opacity-70 shadow-md bg-surface z-10',
      )}
    >
      <button
        type="button"
        aria-label="拖动排序"
        className="grid place-items-center w-8 h-8 rounded-[9px] text-on-surface-2 cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
        <FileText size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 truncate">{item.file.name}</p>
        <p className="text-[11px] text-on-surface-2">第 {index + 1} 个 · {(item.file.size / 1024).toFixed(0)} KB</p>
      </div>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="移除">
        <X size={16} />
      </Button>
    </li>
  )
}
