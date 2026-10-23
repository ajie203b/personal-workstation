import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, RotateCw, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { applyPageOps } from './pdfOps'
import { openPdfDocument, renderPageThumb, type PDFDocumentProxy } from './pdfRender'
import { type ToolOutput } from './output'
import { FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'
import { arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { DragSort, DragSortItem } from '@/shared/ui/DragSort'

interface PageItem {
  /** 1 起 */
  no: number
  thumb?: string
  removed: boolean
  /** 用户追加的旋转（0/90/180/270） */
  rot: number
}

/** 删除 / 旋转页：缩略图网格多选，可见区域才渲（scale 0.2 小图） */
export function PagesPanel() {
  const toast = useUi((s) => s.toast)
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PageItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [name, setName] = useState('整理')
  const loadId = useRef(0)
  useEffect(() => () => { loadId.current++ }, [])

  // 换文件 / 卸载时释放 pdf.js 文档
  useEffect(() => () => void doc?.destroy(), [doc])

  const pick = async (f: File) => {
    const request = ++loadId.current
    setFile(f)
    setDoc(null)
    setPages([])
    setSelected(new Set())
    try {
      const opened = await openPdfDocument(await fileBytes(f))
      if (request !== loadId.current) { void opened.destroy(); return }
      setDoc(opened)
      setPages(Array.from({ length: opened.numPages }, (_, i) => ({ no: i + 1, removed: false, rot: 0 })))
    } catch {
      if (request !== loadId.current) return
      toast('打不开这份 PDF（可能已损坏或格式特殊）')
      setFile(null)
    }
  }

  const clear = () => {
    loadId.current++
    setFile(null)
    setDoc(null)
    setPages([])
    setSelected(new Set())
  }

  const toggle = (no: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(no)) next.delete(no)
      else next.add(no)
      return next
    })
  }

  const removeSelected = () => {
    if (!selected.size) return toast('先点选要删的页')
    if (pages.filter(p => !p.removed && !selected.has(p.no)).length === 0) return toast('至少保留一页，不能删掉全部页面')
    setPages((list) => list.map((p) => (selected.has(p.no) ? { ...p, removed: true } : p)))
    setSelected(new Set())
  }

  const rotateSelected = () => {
    if (!selected.size) return toast('先点选要转的页')
    setPages((list) => list.map((p) => (selected.has(p.no) ? { ...p, rot: (p.rot + 90) % 360 } : p)))
  }

  const reset = () => {
    setPages((list) => list.map((p) => ({ ...p, removed: false, rot: 0 })).sort((a, b) => a.no - b.no))
    setSelected(new Set())
  }

  const make = useCallback(async (selectedOnly = false): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    const bytes = await fileBytes(file)
    const remove = pages.filter((p) => p.removed || (selectedOnly && !selected.has(p.no))).map((p) => p.no)
    const rotate: Record<number, number> = {}
    for (const p of pages) if (p.rot) rotate[p.no] = p.rot
    const out = await applyPageOps(bytes, { remove, rotate, order: pages.map(p => p.no) })
    return { blob: pdfBlob(out), filename: `${name.trim() || '整理'}${selectedOnly ? '-选中页' : ''}.pdf`, isPdf: true }
  }, [file, pages, name, selected])

  const alive = pages.filter((p) => !p.removed)

  return (
    <Panel title="页面整理" desc="长按缩略图拖动页序，点选后批量旋转或删除；可单独导出选中页。">
      {file ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
            <FileText size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 truncate">{file.name}</p>
            <p className="text-[11px] text-on-surface-2">
              保留 {alive.length} / {pages.length} 页{selected.size ? ` · 已选 ${selected.size} 页` : ''}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={clear} aria-label="移除">
            <X size={16} />
          </Button>
        </div>
      ) : (
        <FilePicker accept="application/pdf" label="选择 PDF" onPick={(files) => void pick(files[0])} />
      )}

      {pages.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => setSelected(new Set(alive.map((p) => p.no)))}>
              全选
            </Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>
              清空选择
            </Button>
            <Button size="sm" onClick={() => setSelected(new Set(alive.filter(p => !selected.has(p.no)).map(p => p.no)))}>反选</Button>
            <Button size="sm" onClick={() => setSelected(new Set(alive.filter(p => p.no % 2 === 1).map(p => p.no)))}>奇数页</Button>
            <Button size="sm" onClick={() => setSelected(new Set(alive.filter(p => p.no % 2 === 0).map(p => p.no)))}>偶数页</Button>
            <Button size="sm" onClick={rotateSelected} disabled={!selected.size}>
              <RotateCw size={14} /> 旋转选中 90°
            </Button>
            <Button size="sm" variant="danger" onClick={removeSelected} disabled={!selected.size}>
              <Trash2 size={14} /> 删除选中
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              重置
            </Button>
            {alive.length < pages.length && <Button size="sm" onClick={() => setPages(list => list.map(p => ({ ...p, removed: false })))}>恢复删页</Button>}
          </div>

          <DragSort ids={alive.map(p => String(p.no))} strategy={rectSortingStrategy} onMove={(active, over) => setPages(list => arrayMove(list, list.findIndex(p => String(p.no) === active), list.findIndex(p => String(p.no) === over)))}>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {alive.map((p) => (
              <DragSortItem id={String(p.no)} key={p.no}>
              <ThumbCell
                doc={doc}
                page={p}
                selected={selected.has(p.no)}
                onToggle={() => toggle(p.no)}
              />
              </DragSortItem>
            ))}
          </div>
          </DragSort>
        </>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-on-surface-2">文件名</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="整理"
          className="w-36 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60"
        />
      </div>

      <OutputBar make={make} action="导出" disabled={!file || !pages.length || !alive.length} />
      {selected.size > 0 && <OutputBar make={() => make(true)} allowLibrary={false} downloadLabel={`导出选中 ${selected.size} 页`} />}
    </Panel>
  )
}

/** 单页缩略图：进入可视区才让 pdf.js 渲（IntersectionObserver + 串行队列） */
function ThumbCell({
  doc,
  page,
  selected,
  onToggle,
}: {
  doc: PDFDocumentProxy | null
  page: PageItem
  selected: boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    setUrl(undefined)
    const el = ref.current
    if (!el || !doc) return
    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        void doc
          .getPage(page.no)
          .then((p) => renderPageThumb(p, 0.2))
          .then((data) => {
            if (!cancelled) setUrl(data)
          })
          .catch(() => undefined)
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [doc, page.no])

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label={`第 ${page.no} 页`}
      aria-pressed={selected}
      className={cn(
        'relative w-full aspect-[3/4] rounded-[10px] overflow-hidden border bg-surface-2 transition-colors',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-outline',
      )}
    >
      {url ? (
        <img
          src={url}
          alt={`第 ${page.no} 页`}
          className="w-full h-full object-contain transition-transform duration-150"
          style={{ transform: page.rot ? `rotate(${page.rot}deg)` : undefined }}
          draggable={false}
        />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-surface-3/60" />
      )}
      <span
        className={cn(
          'absolute left-1 bottom-1 px-1.5 py-0.5 rounded-full text-[10px] leading-none',
          selected ? 'bg-primary text-on-primary' : 'bg-surface/85 text-on-surface-2',
        )}
      >
        {page.no}
        {page.rot ? ` · ${page.rot}°` : ''}
      </span>
    </button>
  )
}
