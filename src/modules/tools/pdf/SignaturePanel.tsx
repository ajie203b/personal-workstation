import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, CopyPlus, Eraser, ImagePlus, PenLine, Save, Trash2, Undo2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { usePdfHandoff } from './handoff'
import { inferImageMime } from './imageInput'
import {
  INK_COLOR,
  INK_COLORS,
  bytesToDataUrl,
  drawDot,
  drawSegment,
  drawStrokes,
  strokeSegments,
  strokesBounds,
  type StrokePoint,
} from './signature'
import { placementRect } from './layout'
import { pdfPageInfos, stampPngs } from './pdfOps'
import { signaturePlacementStamps, type SignaturePlacement as Placement } from './signaturePlacement'
import { openPdfDocument, renderPageThumb, type PDFDocumentProxy } from './pdfRender'
import { addSignature, listSignatures, removeSignature, type SignatureRow } from './signatureStore'
import { type ToolOutput } from './output'
import { FIELD_INPUT, Field, FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'

/** 把上传的签名/公章图片解码并规整为透明 PNG dataURL（超大图等比缩放到 1200px 以内）。 */
async function normalizeSignatureImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const maxEdge = 1200
    const scale = Math.min(1, maxEdge / Math.max(1, bmp.width, bmp.height))
    const width = Math.max(1, Math.round(bmp.width * scale))
    const height = Math.max(1, Math.round(bmp.height * scale))
    if (inferImageMime(file) === 'image/png' && scale === 1) {
      const raw = new Uint8Array(await file.arrayBuffer())
      return { dataUrl: bytesToDataUrl(raw, 'image/png'), width, height }
    }
    const canvas = document.createElement('canvas')
    try {
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('当前环境不支持 canvas')
      ctx.drawImage(bmp, 0, 0, width, height)
      return { dataUrl: canvas.toDataURL('image/png'), width, height }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    bmp.close?.()
  }
}

/** 手写签名：Pointer Events 画板（中点平滑 + 速度变线宽）→ 透明 PNG 存库 → 贴到页面 */
export function SignaturePanel() {
  const toast = useUi((s) => s.toast)
  const library = useLiveQuery(() => listSignatures(), []) ?? []
  const [activeId, setActiveId] = useState('')
  const active = library.find((s) => s.id === activeId) ?? null
  const uploadRef = useRef<HTMLInputElement>(null)

  // PDF 与放置
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [total, setTotal] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [preview, setPreview] = useState<string>()
  const [placements, setPlacements] = useState<Placement[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('签名文档')
  const loadId = useRef(0)
  useEffect(() => () => { loadId.current++ }, [])

  useEffect(() => () => void doc?.destroy(), [doc])

  const pick = useCallback(async (f: File) => {
    const request = ++loadId.current
    setFile(f)
    setDoc(null)
    setPreview(undefined)
    setPlacements([])
    setSelectedId('')
    setPageIndex(0)
    try {
      const opened = await openPdfDocument(await fileBytes(f))
      if (request !== loadId.current) { void opened.destroy(); return }
      setDoc(opened)
      setTotal(opened.numPages)
    } catch {
      if (request !== loadId.current) return
      toast('打不开这份 PDF（可能已损坏或格式特殊）')
      setFile(null)
    }
  }, [toast])

  usePdfHandoff('sign', (incoming) => void pick(incoming))

  // 预览图：换页时渲染一次（scale 1 的小图，展示时 CSS 缩放即可）
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    setPreview(undefined)
    void doc
      .getPage(pageIndex + 1)
      .then((p) => renderPageThumb(p, 1))
      .then((url) => {
        if (!cancelled) setPreview(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [doc, pageIndex])

  const onSaveSignature = async (dataUrl: string, width: number, height: number, customName?: string) => {
    const row = await addSignature({ name: customName || `签名 ${library.length + 1}`, dataUrl, width, height })
    setActiveId(row.id)
    toast(customName ? '签名 / 公章已导入' : '签名已保存')
  }

  const onUploadSignature = async (f: File) => {
    try {
      const img = await normalizeSignatureImage(f)
      const label = f.name.replace(/\.[^.]+$/, '') || '印章/签名'
      await onSaveSignature(img.dataUrl, img.width, img.height, label)
    } catch {
      toast('图片无法读取，请选择清晰的 PNG / JPG / WebP 签名或公章图')
    }
  }

  const place = (nx: number, ny: number) => {
    if (!active) return toast('先在签名库里选一枚签名')
    const p: Placement = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pageIndex, nx, ny, nw: 0.28, signature: active }
    setPlacements((list) => [...list, p])
    setSelectedId(p.id)
  }

  const applySelectedToAllPages = () => {
    if (!selected || total <= 1) return
    setPlacements((list) => {
      const additions: Placement[] = []
      for (let i = 0; i < total; i++) {
        if (i === selected.pageIndex) continue
        const exists = list.some(
          (item) =>
            item.pageIndex === i &&
            item.signature.id === selected.signature.id &&
            Math.abs(item.nx - selected.nx) < 0.01 &&
            Math.abs(item.ny - selected.ny) < 0.01,
        )
        if (exists) continue
        additions.push({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          pageIndex: i,
          nx: selected.nx,
          ny: selected.ny,
          nw: selected.nw,
          signature: selected.signature,
        })
      }
      return additions.length ? [...list, ...additions] : list
    })
    toast(`已应用到全部 ${total} 页`)
  }

  const make = async (): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    if (!placements.length) throw new Error('还没有放置签名')
    const bytes = await fileBytes(file)
    const infos = await pdfPageInfos(bytes)
    const stamps = signaturePlacementStamps(placements, infos)
    return {
      blob: pdfBlob(await stampPngs(bytes, stamps)),
      filename: `${name.trim() || '签名文档'}.pdf`,
      isPdf: true,
    }
  }

  const selected = placements.find((p) => p.id === selectedId) ?? null

  return (
    <>
      <Panel title="手写签名" desc="手指或鼠标签名，也支持导入透明 PNG 签名或公章图，保存后点页面放置。">
        <SignaturePad onSave={(d, w, h) => void onSaveSignature(d, w, h)} />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[12px] font-medium text-on-surface-2">签名库</p>
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
              className="sr-only"
              onChange={(e) => {
                const picked = e.target.files?.[0]
                e.target.value = ''
                if (picked) void onUploadSignature(picked)
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => uploadRef.current?.click()}
              className="shrink-0 whitespace-nowrap"
            >
              <ImagePlus size={14} /> 导入签名 / 公章图
            </Button>
          </div>
          {library.length === 0 ? (
            <p className="text-[11.5px] text-on-surface-2">还没有签名，先在上面的画板里签一个，或导入 PNG 签名/公章。</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {library.map((row: SignatureRow) => (
                <li
                  key={row.id}
                  className={cn(
                    'relative rounded-[10px] border bg-white text-slate-900 p-2 cursor-pointer transition-colors shadow-xs',
                    row.id === activeId ? 'border-primary ring-2 ring-primary/40' : 'border-outline',
                  )}
                  onClick={() => setActiveId(row.id)}
                >
                  <img
                    src={row.dataUrl}
                    alt={row.name}
                    className="h-12 w-auto max-w-32 object-contain"
                    draggable={false}
                  />
                  <button
                    type="button"
                    aria-label="删除签名"
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-surface border border-outline grid place-items-center text-on-surface-2 hover:text-danger shadow-xs cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeSignature(row.id)
                      if (activeId === row.id) setActiveId('')
                    }}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel
        title="把签名贴到 PDF"
        desc="选好签名后点页面放置；拖动签名位置或拖右下角缩放，导出时自动处理页面旋转。"
      >
        {file ? (
          <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-5 truncate">{file.name}</p>
              <p className="text-[11px] text-on-surface-2">
                {total ? `第 ${pageIndex + 1} / ${total} 页 · 已放置 ${placements.length} 处` : '读取中…'}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => { loadId.current++; setFile(null); setDoc(null); setTotal(0); setPreview(undefined); setPlacements([]); setSelectedId('') }} aria-label="移除">
              <X size={16} />
            </Button>
          </div>
        ) : (
          <FilePicker accept="application/pdf,.pdf" label="选择 PDF" onPick={(files) => void pick(files[0])} />
        )}

        {doc && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" disabled={pageIndex <= 0} onClick={() => setPageIndex((i) => i - 1)}>
                <ChevronLeft size={14} /> 上一页
              </Button>
              <Button size="sm" disabled={pageIndex >= total - 1} onClick={() => setPageIndex((i) => i + 1)}>
                下一页 <ChevronRight size={14} />
              </Button>
              <SelectMenu
                value={String(pageIndex + 1)}
                onChange={(v) => setPageIndex(Number(v) - 1)}
                options={Array.from({ length: total }, (_, i) => ({ value: String(i + 1), label: `第 ${i + 1} 页` }))}
                ariaLabel="跳页"
                triggerClassName="w-24"
                align="end"
              />
            </div>

            <PagePlacer
              preview={preview}
              sig={active}
              placements={placements.filter((p) => p.pageIndex === pageIndex)}
              selectedId={selectedId}
              onPlace={place}
              onSelect={setSelectedId}
              onUpdate={(id, patch) =>
                setPlacements((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
              }
            />

            {selected && selected.pageIndex === pageIndex && (
              <div className="max-w-xl mx-auto w-full flex flex-col gap-2">
                <div>
                  <p className="text-[12px] font-medium text-on-surface-2 mb-1 flex items-center justify-between">
                    <span>签名大小</span>
                    <span className="text-on-surface tabular-nums">{Math.round(selected.nw * 100)}%</span>
                  </p>
                  <input
                    type="range"
                    min={5}
                    max={70}
                    step={1}
                    value={Math.round(selected.nw * 100)}
                    onChange={(e) => {
                      const nw = Number(e.target.value) / 100
                      setPlacements((list) => list.map((p) => (p.id === selected.id ? { ...p, nw } : p)))
                    }}
                    aria-label="签名大小"
                    className="reader-range w-full cursor-pointer"
                    style={{ ['--range-pct' as string]: `${((selected.nw * 100 - 5) / 65) * 100}%` } as React.CSSProperties}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {total > 1 && (
                    <Button size="sm" variant="outline" onClick={applySelectedToAllPages}>
                      <CopyPlus size={13} /> 应用到全部页面
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPlacements((list) => list.filter((p) => p.id !== selected.id))
                      setSelectedId('')
                    }}
                  >
                    <Trash2 size={13} /> 移除这枚签名
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <Field label="文件名">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="签名文档"
            className={FIELD_INPUT}
          />
        </Field>

        <OutputBar make={make} action="导出" disabled={!file || !placements.length} />
      </Panel>
    </>
  )
}

/** 页面预览 + 签名放置层 */
function PagePlacer({
  preview,
  sig,
  placements,
  selectedId,
  onPlace,
  onSelect,
  onUpdate,
}: {
  preview?: string
  sig: SignatureRow | null
  placements: Placement[]
  selectedId: string
  onPlace: (nx: number, ny: number) => void
  onSelect: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<Placement, 'nx' | 'ny' | 'nw'>>) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 })
  const dragRef = useRef<
    | { mode: 'move'; id: string; dx: number; dy: number }
    | {
        mode: 'resize'
        id: string
        startClientX: number
        startClientY: number
        leftN: number
        topN: number
        startW: number
        startH: number
        wrapW: number
        aspectHOverW: number
      }
    | null
  >(null)

  const norm = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      nx: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      ny: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'move') {
      const p = norm(e)
      if (p) onUpdate(drag.id, { nx: p.nx - drag.dx, ny: p.ny - drag.dy })
      return
    }
    const dxPx = e.clientX - drag.startClientX
    const dyPx = e.clientY - drag.startClientY
    const deltaFromX = dxPx
    const deltaFromY = dyPx * (drag.startW / Math.max(1, drag.startH))
    const delta = Math.abs(deltaFromX) >= Math.abs(deltaFromY) ? deltaFromX : deltaFromY
    const nw = Math.min(0.7, Math.max(0.05, (drag.startW + delta) / Math.max(1, drag.wrapW)))
    const hn = nw * drag.aspectHOverW
    const nx = Math.min(1 - nw / 2, Math.max(nw / 2, drag.leftN + nw / 2))
    const ny = Math.min(1 - hn / 2, Math.max(hn / 2, drag.topN + hn / 2))
    onUpdate(drag.id, { nx, ny, nw })
  }

  return (
    <div
      ref={wrapRef}
      className="relative max-w-xl mx-auto w-full select-none rounded-[12px] overflow-hidden border border-outline bg-white"
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
    >
      {preview ? (
        <img
          src={preview}
          alt="页面预览"
          className="w-full block"
          draggable={false}
          onLoad={e => setPageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          onClick={(e) => {
            const p = norm(e)
            if (p) onPlace(p.nx, p.ny)
          }}
        />
      ) : (
        <div className="aspect-[3/4] animate-pulse bg-surface-3/60" />
      )}

      {preview && placements.map((p) => {
        const rect = placementRect(pageSize.width, pageSize.height, p.signature.width, p.signature.height, p)
        const selected = p.id === selectedId
        const leftPct = (rect.x / pageSize.width) * 100
        const topPct = (rect.y / pageSize.height) * 100
        const widthPct = (rect.w / pageSize.width) * 100
        const heightPct = (rect.h / pageSize.height) * 100
        return (
          <div
            key={p.id}
            className={cn(
              // touch-none 只上给签名本身：拖动它不会连带滚页，预览区其余部分仍可滑动
              'absolute pointer-events-auto cursor-move touch-none',
              selected && 'ring-2 ring-primary/80 rounded bg-primary/5',
            )}
            style={{
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: `${widthPct}%`,
              height: `${heightPct}%`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              onSelect(p.id)
              const pos = norm(e)
              dragRef.current = {
                mode: 'move',
                id: p.id,
                dx: pos ? pos.nx - (rect.x + rect.w / 2) / pageSize.width : 0,
                dy: pos ? pos.ny - (rect.y + rect.h / 2) / pageSize.height : 0,
              }
            }}
          >
            <img
              src={p.signature.dataUrl}
              alt="签名"
              draggable={false}
              className="w-full h-full object-contain pointer-events-none select-none"
            />
            {selected && (
              <span
                role="presentation"
                aria-label="拖动右下角调整签名大小"
                className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-primary border-2 border-white shadow-md cursor-nwse-resize touch-none grid place-items-center"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const wrapRect = wrapRef.current?.getBoundingClientRect()
                  if (!wrapRect) return
                  e.currentTarget.setPointerCapture(e.pointerId)
                  const leftN = rect.x / pageSize.width
                  const topN = rect.y / pageSize.height
                  const wN = rect.w / pageSize.width
                  const hN = rect.h / pageSize.height
                  dragRef.current = {
                    mode: 'resize',
                    id: p.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    leftN,
                    topN,
                    startW: wN * wrapRect.width,
                    startH: hN * wrapRect.height,
                    wrapW: wrapRect.width,
                    aspectHOverW: hN / Math.max(1e-6, wN),
                  }
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
              </span>
            )}
          </div>
        )
      })}

      {!sig && (
        <p className="absolute inset-x-0 bottom-0 p-2 text-center text-[11px] text-on-surface-2 bg-surface">
          先在上面签名并选中，再点页面放置
        </p>
      )}
    </div>
  )
}

/** 导出 PNG 的放大倍数：按 CSS 像素记录笔迹，导出时 2× 重绘，贴到 PDF 上不发虚 */
const EXPORT_SCALE = 2

/**
 * 画板：Pointer Events 统一鼠标/触摸/手写笔。
 * 平滑用二次贝塞尔中点法，线宽按速度收放（strokeSegments）。
 */
function SignaturePad({ onSave }: { onSave: (dataUrl: string, width: number, height: number) => void }) {
  const toast = useUi((s) => s.toast)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [inkColor, setInkColor] = useState<string>(INK_COLOR)
  const inkColorRef = useRef<string>(INK_COLOR)
  const [strokeCount, setStrokeCount] = useState(0)
  /** 全部笔画（CSS 像素坐标） */
  const strokesRef = useRef<StrokePoint[][]>([])
  /** 正在画的那一笔 */
  const currentRef = useRef<StrokePoint[] | null>(null)
  /** 画板 CSS 尺寸 */
  const sizeRef = useRef({ w: 0, h: 0 })

  const ctxOf = () => canvasRef.current?.getContext('2d') ?? null

  /** backing store 对齐 CSS 尺寸 × dpr，并按笔迹重绘 */
  const syncSize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    sizeRef.current = { w, h }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const list = currentRef.current ? [...strokesRef.current, currentRef.current] : strokesRef.current
    drawStrokes(ctx, list, inkColorRef.current)
  }, [])

  useEffect(() => {
    syncSize()
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => syncSize())
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [syncSize])

  /** 指针 → 画板 CSS 像素坐标（同一套坐标画、存、导出） */
  const toLocal = (e: ReactPointerEvent): StrokePoint => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const { w, h } = sizeRef.current
    const rw = rect?.width || w || 1
    const rh = rect?.height || h || 1
    const x = ((e.clientX - (rect?.left ?? 0)) / rw) * (w || rw)
    const y = ((e.clientY - (rect?.top ?? 0)) / rh) * (h || rh)
    return { x, y, t: performance.now() }
  }

  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    // 尺寸可能在画板显示后才稳定（折叠面板 / 旋转屏幕），落笔前对一次
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect && (Math.round(rect.width) !== sizeRef.current.w || Math.round(rect.height) !== sizeRef.current.h)) syncSize()
    const p = toLocal(e)
    currentRef.current = [p]
    const ctx = ctxOf()
    if (ctx) drawDot(ctx, p, inkColorRef.current)
  }

  const onMove = (e: ReactPointerEvent) => {
    const pts = currentRef.current
    if (!pts || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    // 合并事件（getCoalescedEvents）补齐快速甩笔时丢的采样点
    const native = e.nativeEvent as PointerEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const samples = events.length ? events : [native]
    const ctx = ctxOf()
    for (const ev of samples) {
      pts.push(toLocal(ev as unknown as ReactPointerEvent))
      if (pts.length < 3 || !ctx) continue
      // 新闭合的那一段 = 平滑线段里倒数第二段（最后一段是指向笔尖的收尾段）
      const segs = strokeSegments(pts)
      drawSegment(ctx, segs[segs.length - 2], inkColorRef.current)
    }
  }

  const onUp = (e: ReactPointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const pts = currentRef.current
    currentRef.current = null
    if (!pts) return
    if (pts.length >= 2) {
      const segs = strokeSegments(pts)
      const ctx = ctxOf()
      if (ctx) drawSegment(ctx, segs[segs.length - 1], inkColorRef.current)
    }
    strokesRef.current.push(pts)
    setStrokeCount(strokesRef.current.length)
  }

  const undo = () => {
    if (!strokesRef.current.length) return
    strokesRef.current.pop()
    setStrokeCount(strokesRef.current.length)
    syncSize()
  }

  const clear = () => {
    strokesRef.current = []
    currentRef.current = null
    setStrokeCount(0)
    const ctx = ctxOf()
    const { w, h } = sizeRef.current
    ctx?.clearRect(0, 0, w, h)
  }

  const selectInkColor = (next: string) => {
    inkColorRef.current = next
    setInkColor(next)
    syncSize()
  }

  const save = () => {
    const strokes = strokesRef.current
    const { w: boardW, h: boardH } = sizeRef.current
    const box = strokesBounds(strokes, boardW || 10000, boardH || 10000)
    if (!box) {
      toast('先在画板上签名')
      return
    }
    // 按包围盒把全部笔迹矢量重绘到透明画布（2×），四周留白已含在 box 里
    const out = document.createElement('canvas')
    try {
      out.width = Math.max(1, Math.round(box.width * EXPORT_SCALE))
      out.height = Math.max(1, Math.round(box.height * EXPORT_SCALE))
      const ctx = out.getContext('2d')
      if (!ctx) return
      ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, -box.x * EXPORT_SCALE, -box.y * EXPORT_SCALE)
      drawStrokes(ctx, strokes, inkColorRef.current)
      onSave(out.toDataURL('image/png'), out.width, out.height)
    } finally {
      out.width = 0
      out.height = 0
    }
    clear()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-[12px] border border-outline bg-white text-slate-900 overflow-hidden shadow-xs">
        <canvas
          ref={canvasRef}
          className="w-full h-[180px] touch-none cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <span className="absolute left-3 right-3 bottom-2 border-b border-dashed border-slate-300 pointer-events-none" />
        <span className="absolute right-3 bottom-2.5 text-[10.5px] text-slate-400 pointer-events-none">签名区</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 mr-1" role="group" aria-label="墨水颜色">
          {INK_COLORS.map((c) => {
            const active = inkColor === c.value
            return (
              <button
                key={c.value}
                type="button"
                aria-label={`墨水颜色：${c.label}`}
                aria-pressed={active}
                onClick={() => selectInkColor(c.value)}
                className={cn(
                  'w-6 h-6 rounded-full border-2 transition-transform cursor-pointer shrink-0',
                  active ? 'border-primary scale-110 ring-2 ring-primary/30' : 'border-outline hover:scale-105',
                )}
                style={{ backgroundColor: c.value }}
                title={c.label}
              />
            )
          })}
        </div>
        <Button size="sm" variant="outline" onClick={undo} disabled={strokeCount === 0} className="shrink-0 whitespace-nowrap">
          <Undo2 size={14} /> 撤销
        </Button>
        <Button size="sm" variant="outline" onClick={clear} disabled={strokeCount === 0} className="shrink-0 whitespace-nowrap">
          <Eraser size={14} /> 清除
        </Button>
        <Button size="sm" variant="primary" onClick={save} className="shrink-0 whitespace-nowrap">
          <Save size={14} /> 保存签名
        </Button>
        <span className="text-[11px] text-on-surface-2 inline-flex items-center gap-1 w-full sm:w-auto sm:ml-auto">
          <PenLine size={12} className="shrink-0" /> 快笔画会自动变细，像真笔锋
        </span>
      </div>
    </div>
  )
}
