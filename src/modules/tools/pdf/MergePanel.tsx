import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, FileText, GripVertical, X } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { Button } from '@/shared/ui/Button'
import { formatBytes } from '@/lib/format'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'
import { SORT_TRANSITION } from '@/lib/sortMotion'
import { uid } from '@/lib/id'
import { usePdfHandoff } from './handoff'
import { mergePdfs } from './pdfOps'
import { yieldToUi, type ToolOutput } from './output'
import { FIELD_INPUT, Field, FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'

interface Item {
  id: string
  file: File
  pages?: number
}

/** 合并：多 PDF 拖拽或按钮排序 → 按顺序拼成一份 */
export function MergePanel() {
  const [items, setItems] = useState<Item[]>([])
  const [name, setName] = useState('合并')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 桌面按下拖 6px 起拖、手机长按 200ms 起拖、键盘空格+方向键可排序
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const addFiles = useCallback((files: File[]) => {
    const added = files.map((file) => ({ id: uid(), file }))
    setItems((list) => [...list, ...added])
    for (const entry of added) {
      void fileBytes(entry.file)
        .then((bytes) => PDFDocument.load(bytes))
        .then((doc) => {
          if (!mounted.current) return
          const pages = doc.getPageCount()
          setItems((list) => list.map((it) => (it.id === entry.id ? { ...it, pages } : it)))
        })
        .catch(() => undefined)
    }
  }, [])

  usePdfHandoff('merge', (incoming) => addFiles([incoming]))

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    haptic('light')
    setItems((list) => arrayMove(list, from, to))
  }

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

  const totalPages = items.reduce((sum, it) => sum + (it.pages ?? 0), 0)
  const allCounted = items.every((it) => typeof it.pages === 'number')
  const totalBytes = items.reduce((sum, it) => sum + it.file.size, 0)

  return (
    <Panel title="合并 PDF" desc="多个 PDF 按列表顺序拼成一份，支持拖动手柄、键盘或上下按钮调序。">
      <FilePicker
        accept="application/pdf,.pdf"
        multiple
        label="添加 PDF"
        hint="可一次选多个或拖拽到此处"
        onPick={addFiles}
      />

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-on-surface-2 px-1">
            <span>共 {items.length} 份文件 · {allCounted ? `合计 ${totalPages} 页` : '统计页数中…'}</span>
            <span className="tabular-nums">{formatBytes(totalBytes)}</span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2">
                {items.map((it, index) => (
                  <MergeRow
                    key={it.id}
                    item={it}
                    index={index}
                    total={items.length}
                    onMoveUp={() => moveItem(index, index - 1)}
                    onMoveDown={() => moveItem(index, index + 1)}
                    onRemove={() => setItems((list) => list.filter((i) => i.id !== it.id))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="合并"
          className={FIELD_INPUT}
        />
      </Field>

      <OutputBar make={make} action="合并" disabled={items.length < 2} />
    </Panel>
  )
}

function MergeRow({
  item,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  item: Item
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, transition: SORT_TRANSITION })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 sm:gap-2 rounded-[12px] border border-outline bg-surface-2 px-2 py-2',
        isDragging && 'opacity-70 shadow-md bg-surface z-10',
      )}
    >
      <button
        type="button"
        aria-label={`拖动排序 ${item.file.name}`}
        className="grid place-items-center w-8 h-8 rounded-[9px] text-on-surface-2 cursor-grab active:cursor-grabbing touch-none shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="hidden sm:grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
        <FileText size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 truncate">{item.file.name}</p>
        <p className="text-[11px] text-on-surface-2 tabular-nums">
          第 {index + 1} 个{typeof item.pages === 'number' ? ` · ${item.pages} 页` : ''} · {formatBytes(item.file.size)}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button variant="ghost" size="icon" className="w-8 h-8" disabled={index === 0} onClick={onMoveUp} aria-label="上移">
          <ArrowUp size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="w-8 h-8" disabled={index === total - 1} onClick={onMoveDown} aria-label="下移">
          <ArrowDown size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={onRemove} aria-label="移除">
          <X size={15} />
        </Button>
      </div>
    </li>
  )
}
