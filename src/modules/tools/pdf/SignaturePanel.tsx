import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Eraser, PenLine, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { dataUrlToBytes, smoothStroke, velocityWidth, type StrokePoint } from './signature'
import { placementRect } from './layout'
import { pdfPageInfos, stampPngs, type Stamp } from './pdfOps'
import { openPdfDocument, renderPageThumb, type PDFDocumentProxy } from './pdfRender'
import { addSignature, listSignatures, removeSignature, type SignatureRow } from './signatureStore'
import { type ToolOutput } from './output'
import { FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'

interface Placement {
  id: string
  pageIndex: number
  /** 签名中心相对页宽/页高的位置（0~1，视觉坐标） */
  nx: number
  ny: number
  /** 签名宽占页宽比例 */
  nw: number
}

/** 手写签名：Pointer Events 画板（中点平滑 + 速度变线宽）→ 透明 PNG 存库 → 贴到页面 */
export function SignaturePanel() {
  const toast = useUi((s) => s.toast)
  const library = useLiveQuery(() => listSignatures(), []) ?? []
  const [activeId, setActiveId] = useState('')
  const active = library.find((s) => s.id === activeId) ?? null

  // PDF 与放置
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [total, setTotal] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [preview, setPreview] = useState<string>()
  const [placements, setPlacements] = useState<Placement[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('签名文档')

  useEffect(() => () => void doc?.destroy(), [doc])

  const pick = async (f: File) => {
    setFile(f)
    setDoc(null)
    setPreview(undefined)
    setPlacements([])
    setPageIndex(0)
    try {
      const opened = await openPdfDocument(await fileBytes(f))
      setDoc(opened)
      setTotal(opened.numPages)
    } catch {
      toast('打不开这份 PDF（可能已损坏或格式特殊）')
      setFile(null)
    }
  }

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

  const onSaveSignature = async (dataUrl: string, width: number, height: number) => {
    const row = await addSignature({ name: `签名 ${library.length + 1}`, dataUrl, width, height })
    setActiveId(row.id)
    toast('签名已保存')
  }

  const place = (nx: number, ny: number) => {
    if (!active) return toast('先在签名库里选一枚签名')
    const p: Placement = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pageIndex, nx, ny, nw: 0.28 }
    setPlacements((list) => [...list, p])
    setSelectedId(p.id)
  }

  const make = async (): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    if (!placements.length) throw new Error('还没有放置签名')
    const sig = active
    if (!sig) throw new Error('签名库里没有可用签名')
    const bytes = await fileBytes(file)
    const infos = await pdfPageInfos(bytes)
    // v1 简化：所有放置共用当前选中的签名
    const png = dataUrlToBytes(sig.dataUrl)
    const stamps: Stamp[] = []
    for (const p of placements) {
      const info = infos[p.pageIndex]
      if (!info) continue
      const rect = placementRect(info.visW, info.visH, sig.width, sig.height, p)
      stamps.push({ pageIndex: p.pageIndex, png, rect })
    }
    return {
      blob: pdfBlob(await stampPngs(bytes, stamps)),
      filename: `${name.trim() || '签名文档'}.pdf`,
      isPdf: true,
    }
  }

  const selected = placements.find((p) => p.id === selectedId) ?? null

  return (
    <>
      <Panel title="手写签名" desc="手指或鼠标签名，保存后从签名库选一枚，点页面放置、拖动移动。">
        <SignaturePad onSave={(d, w, h) => void onSaveSignature(d, w, h)} />
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-medium text-on-surface-2">签名库</p>
          {library.length === 0 ? (
            <p className="text-[11.5px] text-on-surface-2">还没有签名，先在上面的画板里签一个。</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {library.map((row: SignatureRow) => (
                <li
                  key={row.id}
                  className={cn(
                    'relative rounded-[10px] border bg-surface-2 p-2 cursor-pointer transition-colors',
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
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface border border-outline grid place-items-center text-on-surface-2 hover:text-danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeSignature(row.id)
                      if (activeId === row.id) setActiveId('')
                    }}
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel
        title="把签名贴到 PDF"
        desc="选好签名后点页面放置；按住签名拖动微调，滑杆改大小。导出时按视觉位置贴正，自动处理页面旋转。"
      >
        {file ? (
          <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-5 truncate">{file.name}</p>
              <p className="text-[11px] text-on-surface-2">
                {total ? `第 ${pageIndex + 1} / ${total} 页 · 已放置 ${placements.length} 处` : '读取中…'}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="移除">
              <X size={16} />
            </Button>
          </div>
        ) : (
          <FilePicker accept="application/pdf" label="选择 PDF" onPick={(files) => void pick(files[0])} />
        )}

        {doc && (
          <>
            <div className="flex items-center gap-2">
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
              onMove={(id, nx, ny) =>
                setPlacements((list) => list.map((p) => (p.id === id ? { ...p, nx, ny } : p)))
              }
            />

            {selected && selected.pageIndex === pageIndex && (
              <div>
                <p className="text-[12px] font-medium text-on-surface-2 mb-1 flex items-center justify-between">
                  <span>签名大小</span>
                  <span className="text-on-surface tabular-nums">{Math.round(selected.nw * 100)}%</span>
                </p>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={1}
                  value={Math.round(selected.nw * 100)}
                  onChange={(e) => {
                    const nw = Number(e.target.value) / 100
                    setPlacements((list) => list.map((p) => (p.id === selected.id ? { ...p, nw } : p)))
                  }}
                  aria-label="签名大小"
                  className="reader-range w-full cursor-pointer"
                  style={{ ['--range-pct' as string]: `${((selected.nw * 100 - 5) / 55) * 100}%` } as React.CSSProperties}
                />
                <Button
                  size="sm"
                  variant="danger"
                  className="mt-1"
                  onClick={() => {
                    setPlacements((list) => list.filter((p) => p.id !== selected.id))
                    setSelectedId('')
                  }}
                >
                  <Trash2 size={13} /> 移除这枚签名
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-on-surface-2 shrink-0">文件名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="签名文档"
            className="w-40 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60"
          />
        </div>

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
  onMove,
}: {
  preview?: string
  sig: SignatureRow | null
  placements: Placement[]
  selectedId: string
  onPlace: (nx: number, ny: number) => void
  onSelect: (id: string) => void
  onMove: (id: string, nx: number, ny: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)

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
    const p = norm(e)
    if (p) onMove(drag.id, p.nx - drag.dx, p.ny - drag.dy)
  }

  return (
    <div
      ref={wrapRef}
      className="relative select-none rounded-[12px] overflow-hidden border border-outline bg-surface-2"
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
          onClick={(e) => {
            const p = norm(e)
            if (p) onPlace(p.nx, p.ny)
          }}
        />
      ) : (
        <div className="aspect-[3/4] animate-pulse bg-surface-3/60" />
      )}

      {sig &&
        placements.map((p) => (
          <img
            key={p.id}
            src={sig.dataUrl}
            alt="签名"
            draggable={false}
            className={cn(
              // touch-none 只上给签名本身：拖动它不会连带滚页，预览区其余部分仍可滑动
              'absolute pointer-events-auto cursor-move touch-none',
              p.id === selectedId && 'outline outline-2 outline-primary/70 rounded',
            )}
            style={{
              left: `${p.nx * 100}%`,
              top: `${p.ny * 100}%`,
              width: `${p.nw * 100}%`,
              height: 'auto',
              transform: 'translate(-50%, -50%)',
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              onSelect(p.id)
              const pos = norm(e)
              dragRef.current = { id: p.id, dx: pos ? pos.nx - p.nx : 0, dy: pos ? pos.ny - p.ny : 0 }
            }}
          />
        ))}

      {!sig && (
        <p className="absolute inset-x-0 bottom-0 p-2 text-center text-[11px] text-on-surface-2 bg-surface/80">
          先在上面签名并选中，再点页面放置
        </p>
      )}
    </div>
  )
}

/**
 * 画板：Pointer Events 统一鼠标/触摸/手写笔。
 * 平滑用二次贝塞尔中点法（smoothStroke），线宽按速度收放（velocityWidth）。
 */
function SignaturePad({ onSave }: { onSave: (dataUrl: string, width: number, height: number) => void }) {
  const toast = useUi((s) => s.toast)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef<StrokePoint[]>([])

  const ctxOf = () => canvasRef.current?.getContext('2d') ?? null

  const strokeSeg = useCallback((from: { x: number; y: number }, ctrl: { x: number; y: number }, to: { x: number; y: number }, width: number) => {
    const ctx = ctxOf()
    if (!ctx) return
    ctx.strokeStyle = '#1c1c1e'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y)
    ctx.stroke()
  }, [])

  // 画布按 dpr 铺满：固定 640×240 逻辑尺寸，导出时裁掉空白边
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = 640 * dpr
    canvas.height = 240 * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, 640, 240)
    }
  }, [])

  const toLogical = (e: ReactPointerEvent): StrokePoint => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const x = ((e.clientX - (rect?.left ?? 0)) / (rect?.width ?? 1)) * 640
    const y = ((e.clientY - (rect?.top ?? 0)) / (rect?.height ?? 1)) * 240
    return { x, y, t: performance.now() }
  }

  const onDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toLogical(e)
    pointsRef.current = [p]
    const ctx = ctxOf()
    if (ctx) {
      ctx.fillStyle = '#1c1c1e'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const onMove = (e: ReactPointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const pts = pointsRef.current
    const p = toLogical(e)
    pts.push(p)
    if (pts.length < 3) return
    // 新闭合的那一段 = 最近三点的中点平滑首段
    const [seg] = smoothStroke(pts.slice(-3))
    const width = velocityWidth(pts[pts.length - 2], p, 7, 1.8)
    strokeSeg(seg.from, seg.ctrl, seg.to, width)
  }

  const onUp = (e: ReactPointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const pts = pointsRef.current
    if (pts.length >= 2) {
      const segs = smoothStroke(pts)
      const last = segs[segs.length - 1]
      strokeSeg(last.from, last.ctrl, last.to, velocityWidth(pts[pts.length - 2], pts[pts.length - 1], 7, 1.8))
    }
  }

  const clear = () => {
    pointsRef.current = []
    const ctx = ctxOf()
    ctx?.clearRect(0, 0, 640, 240)
  }

  const save = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pts = pointsRef.current
    if (!pts.length) {
      toast('先在画板上签名')
      return
    }
    // 裁掉透明边：从墨迹包围盒出图，贴到页面上才不会四周空一大圈
    const pad = 8
    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) - pad))
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) - pad))
    const maxX = Math.min(640, Math.ceil(Math.max(...pts.map((p) => p.x)) + pad))
    const maxY = Math.min(240, Math.ceil(Math.max(...pts.map((p) => p.y)) + pad))
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h)
    onSave(out.toDataURL('image/png'), w, h)
    clear()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-[12px] border border-outline bg-surface overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-[180px] touch-none cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <span className="absolute left-3 right-3 bottom-2 border-b border-dashed border-outline pointer-events-none" />
        <span className="absolute right-3 bottom-2.5 text-[10.5px] text-on-surface-2 pointer-events-none">签名区</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={clear}>
          <Eraser size={14} /> 清除
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          <Save size={14} /> 保存签名
        </Button>
        <span className="text-[11px] text-on-surface-2 inline-flex items-center gap-1">
          <PenLine size={12} /> 快笔画会自动变细，像真笔锋
        </span>
      </div>
    </div>
  )
}
