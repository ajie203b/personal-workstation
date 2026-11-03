import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronLeft, ChevronRight, Eraser, FilePlus2, FileX2, Loader2, MoreHorizontal, PenLine, Redo2, Settings2, Sigma, Trash2, Undo2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuSeparator } from '@/shared/ui/Menu'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { BackButton } from '@/shared/ui/BackButton'
import { answerAnchor, clusterStrokes, detectTrailingEquals, estimateCharHeight, pressureWidth, smoothAppend, strokeBox, strokesHitBy } from './geometry'
import { MathEngine } from './mathEngine'
import { MathView } from './MathView'
import { MathEditorDialog } from './MathEditorDialog'
import { MODEL_SOURCES, DEFAULT_SOURCE, type ModelSourceConfig, type ModelSourceId } from './recognizer'
import { deletePage, getLastPageId, getSource, listPages, newPage, savePage, setLastPageId, setSource } from './store'
import type { BlockResult, InkBlock, InkPoint, MathNotePage, Stroke } from './types'
import { uid } from '@/lib/id'

/** 答案颜色：苹果数学笔记那种暖黄/橙，深浅色模式下都醒目 */
const ANSWER_COLOR = '#F29D0B'
/** 手写风格字体：各平台自带的手写体，最后退到系统 cursive（安卓是 Dancing Script） */
const HAND_FONT = '"Bradley Hand", "Segoe Print", "Chalkboard SE", "Comic Sans MS", "Kaiti SC", STKaiti, KaiTi, cursive'
const PEN_WIDTH = 2.6
const ERASER_RADIUS = 12
/** 停笔多久自动识别（毫秒） */
const IDLE_MS = 1000
const GRID = 28

type Tool = 'pen' | 'eraser'
type Action = { type: 'add'; strokes: Stroke[] } | { type: 'erase'; strokes: Stroke[] } | { type: 'clear'; strokes: Stroke[] }
type ModelState =
  | { phase: 'idle' }
  | { phase: 'loading'; ratio: number; file: string }
  | { phase: 'ready'; backend: string }
  | { phase: 'error'; message: string }

interface OverlayItem {
  key: string
  block: InkBlock
  res: BlockResult
  x: number
  y: number
  fontSize: number
  placement: 'inline' | 'below'
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** 画一笔：中点二次曲线平滑，线宽随压感逐段变化 */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, from = 0) {
  const pts = s.points
  if (!pts.length) return
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, pressureWidth(s.width, pts[0].p) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const prevMid = i >= 2 ? { x: (pts[i - 2].x + p0.x) / 2, y: (pts[i - 2].y + p0.y) / 2 } : p0
    const mid = i === pts.length - 1 ? p1 : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
    ctx.lineWidth = pressureWidth(s.width, (p0.p + p1.p) / 2)
    ctx.beginPath()
    ctx.moveTo(prevMid.x, prevMid.y)
    ctx.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y)
    ctx.stroke()
  }
}

/**
 * 手写计算（数学笔记）：几乎整屏的网格纸画布，手写算式，写下「=」或停笔约 1 秒后
 * 自动识别（本地 Pix2Text MFR 模型），答案用手写风格、暖黄色直接写在等号后面；
 * 没写等号的方程 / 方程组 / 矩阵，结果写在算式下方。点答案可用 MathLive 纠错重算。
 *
 * 画布按笔迹包围盒把笔画聚成独立算式块（横写、竖写都行），每块单独识别、单独出答案。
 * 笔迹和识别结果存本机 IndexedDB（mathNotes 表），支持多页。
 */
export function MathNotesPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MathEngine | null>(null)

  const [pages, setPages] = useState<MathNotePage[]>([])
  const [pageId, setPageId] = useState<string>('')
  const pageRef = useRef<MathNotePage | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const resultsRef = useRef<Map<string, BlockResult>>(new Map())
  const undoRef = useRef<Action[]>([])
  const redoRef = useRef<Action[]>([])
  const inflightRef = useRef<Set<string>>(new Set())
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const [tool, setTool] = useState<Tool>('pen')
  const toolRef = useRef<Tool>('pen')
  toolRef.current = tool
  const [showLatex, setShowLatex] = useState(false)
  const [model, setModel] = useState<ModelState>({ phase: 'idle' })
  const [source, setSourceState] = useState<ModelSourceConfig>(DEFAULT_SOURCE)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [recognizing, setRecognizing] = useState(0)

  const scrollYRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const idleTimer = useRef<number | undefined>(undefined)
  const saveTimer = useRef<number | undefined>(undefined)

  /* ---------- 模型 ---------- */

  const onModelProgress = useCallback((ratio: number, file: string) => {
    setModel({ phase: 'loading', ratio, file })
  }, [])

  const loadModel = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return
    setModel({ phase: 'loading', ratio: 0, file: '' })
    try {
      const backend = await engine.load(onModelProgress)
      setModel({ phase: 'ready', backend })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setModel({ phase: 'error', message: e instanceof Error ? e.message : '模型加载失败' })
    }
  }, [onModelProgress])

  useEffect(() => {
    const engine = new MathEngine()
    engineRef.current = engine
    let alive = true
    void getSource().then((cfg) => {
      if (!alive) return
      setSourceState(cfg)
      engine.setSource(cfg)
      void loadModel()
    })
    return () => {
      alive = false
      engine.dispose()
      engineRef.current = null
    }
  }, [loadModel])

  /* ---------- 页面数据 ---------- */

  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const page = pageRef.current
    if (!page) return
    const keys = new Set(clusterStrokes(strokesRef.current).map((b) => b.key))
    const next: MathNotePage = {
      ...page,
      strokes: strokesRef.current,
      results: [...resultsRef.current.values()].filter((r) => keys.has(r.key)),
    }
    pageRef.current = next
    setPages((ps) => ps.map((p) => (p.id === next.id ? next : p)))
    void savePage(next).catch(() => toast('笔记保存失败'))
  }, [toast])

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(flushSave, 600)
  }, [flushSave])

  const openPage = useCallback(
    (page: MathNotePage) => {
      if (pageRef.current && pageRef.current.id !== page.id) flushSave()
      pageRef.current = page
      strokesRef.current = page.strokes.map((s) => ({ ...s, points: [...s.points] }))
      resultsRef.current = new Map(page.results.map((r) => [r.key, r]))
      undoRef.current = []
      redoRef.current = []
      scrollYRef.current = 0
      setPageId(page.id)
      setLastPageId(page.id)
      bump()
    },
    [bump, flushSave],
  )

  useEffect(() => {
    let alive = true
    void listPages().then(async (rows) => {
      if (!alive) return
      let list = rows
      if (!list.length) {
        const first = newPage(1)
        await savePage(first)
        list = [first]
      }
      setPages(list)
      const last = getLastPageId()
      openPage(list.find((p) => p.id === last) ?? list[list.length - 1])
    })
    return () => {
      alive = false
    }
    // 只在进入页面时加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 离开页面前把没落盘的改动写掉
  useEffect(() => () => flushSave(), [flushSave])

  /* ---------- 画布渲染 ---------- */

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h, dpr } = sizeRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, -scrollYRef.current * dpr)
    const ink = cssVar('--on-surface', '#1d1d1f')
    ctx.strokeStyle = ink
    ctx.fillStyle = ink
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const top = scrollYRef.current - 20
    const bottom = scrollYRef.current + h + 20
    for (const s of strokesRef.current) {
      const b = strokeBox(s)
      if (b.maxY < top || b.minY > bottom || b.maxX < -20 || b.minX > w + 20) continue
      drawStroke(ctx, s)
    }
    if (containerRef.current) containerRef.current.style.backgroundPositionY = `${-scrollYRef.current}px`
    if (overlayRef.current) overlayRef.current.style.transform = `translateY(${-scrollYRef.current}px)`
  }, [])

  useEffect(() => {
    const el = containerRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const resize = () => {
      const rect = el.getBoundingClientRect()
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      sizeRef.current = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      redraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    // 深浅色切换时墨水颜色要跟着变
    const mo = new MutationObserver(redraw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [redraw])

  useEffect(() => {
    redraw()
  }, [version, redraw])

  /* ---------- 识别调度 ---------- */

  const runRecognition = useCallback(() => {
    const engine = engineRef.current
    const page = pageRef.current
    if (!engine || !page) return
    const strokes = strokesRef.current
    const h = estimateCharHeight(strokes)
    const blocks = clusterStrokes(strokes, { charHeight: h })
    for (const block of blocks) {
      if (resultsRef.current.has(block.key) || inflightRef.current.has(block.key)) continue
      const blockStrokes = strokes.filter((s) => block.strokeIds.includes(s.id))
      inflightRef.current.add(block.key)
      setRecognizing((n) => n + 1)
      const pid = page.id
      engine
        .recognize(block.key, blockStrokes, h, onModelProgress)
        .then((r) => {
          if (pageRef.current?.id !== pid) return
          // 模型若是在这次识别里顺带加载完的，状态条也要收起来
          setModel((m) => (m.phase === 'ready' ? m : { phase: 'ready', backend: engine.backend ?? 'wasm' }))
          // 识别期间笔画变了（key 不在了）就丢弃，下一轮会重新识别
          const still = clusterStrokes(strokesRef.current).some((b) => b.key === block.key)
          if (!still) return
          resultsRef.current.set(block.key, { key: block.key, recognized: r.latex, result: r.result })
          bump()
          scheduleSave()
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          const message = e instanceof Error ? e.message : '识别失败'
          setModel((m) => (m.phase === 'loading' ? { phase: 'error', message } : m))
        })
        .finally(() => {
          inflightRef.current.delete(block.key)
          setRecognizing((n) => Math.max(0, n - 1))
        })
    }
  }, [bump, onModelProgress, scheduleSave])

  const scheduleRecognition = useCallback(
    (immediate: boolean) => {
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(runRecognition, immediate ? 60 : IDLE_MS)
    },
    [runRecognition],
  )

  useEffect(() => () => window.clearTimeout(idleTimer.current), [])

  // 打开页面后补识别（例如上次识别到一半就退出了）
  useEffect(() => {
    if (pageId) scheduleRecognition(false)
  }, [pageId, scheduleRecognition])

  const afterChange = useCallback(
    (lastStroke?: Stroke) => {
      bump()
      scheduleSave()
      if (!lastStroke) {
        scheduleRecognition(false)
        return
      }
      const strokes = strokesRef.current
      const h = estimateCharHeight(strokes)
      const block = clusterStrokes(strokes, { charHeight: h }).find((b) => b.strokeIds.includes(lastStroke.id))
      const eq = block ? detectTrailingEquals(strokes.filter((s) => block.strokeIds.includes(s.id)), h) : null
      scheduleRecognition(Boolean(eq))
    },
    [bump, scheduleRecognition, scheduleSave],
  )

  /* ---------- 编辑操作 ---------- */

  const pushAction = (a: Action) => {
    undoRef.current.push(a)
    if (undoRef.current.length > 200) undoRef.current.shift()
    redoRef.current = []
  }

  const undo = useCallback(() => {
    const a = undoRef.current.pop()
    if (!a) return
    if (a.type === 'add') {
      const ids = new Set(a.strokes.map((s) => s.id))
      strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id))
    } else {
      strokesRef.current = [...strokesRef.current, ...a.strokes]
    }
    redoRef.current.push(a)
    afterChange()
  }, [afterChange])

  const redo = useCallback(() => {
    const a = redoRef.current.pop()
    if (!a) return
    if (a.type === 'add') strokesRef.current = [...strokesRef.current, ...a.strokes]
    else {
      const ids = new Set(a.strokes.map((s) => s.id))
      strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id))
    }
    undoRef.current.push(a)
    afterChange()
  }, [afterChange])

  const clearAll = () => {
    if (!strokesRef.current.length) return
    pushAction({ type: 'clear', strokes: strokesRef.current })
    strokesRef.current = []
    resultsRef.current.clear()
    afterChange()
    toast('已清空本页，可点撤销找回')
  }

  // 桌面快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做（捕获阶段拦下，免得触发全局撤销）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, [contenteditable="true"], math-field') || e.isComposing)) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) undo()
      else if ((k === 'z' && e.shiftKey) || k === 'y') redo()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [undo, redo])

  /* ---------- 指针输入 ---------- */

  const drawingRef = useRef<{ pointerId: number; stroke: Stroke; startedAt: number } | null>(null)
  const erasedRef = useRef<Stroke[]>([])
  const penSeenRef = useRef(false)
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panRef = useRef<{ y: number; scroll: number } | null>(null)

  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top + scrollYRef.current }
  }

  const maxScroll = () => {
    let bottom = 0
    for (const s of strokesRef.current) bottom = Math.max(bottom, strokeBox(s).maxY)
    return Math.max(0, bottom + sizeRef.current.h * 0.6)
  }

  const scrollTo = (y: number) => {
    scrollYRef.current = Math.max(0, Math.min(maxScroll(), y))
    redraw()
  }

  const cancelCurrentStroke = () => {
    const d = drawingRef.current
    if (!d) return
    drawingRef.current = null
    redraw()
  }

  const eraseAt = (x: number, y: number) => {
    const hit = new Set(strokesHitBy(strokesRef.current, x, y, ERASER_RADIUS))
    if (!hit.size) return
    erasedRef.current.push(...strokesRef.current.filter((s) => hit.has(s.id)))
    strokesRef.current = strokesRef.current.filter((s) => !hit.has(s.id))
    redraw()
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') penSeenRef.current = true
    if (e.pointerType === 'touch') {
      // 手掌误触：用过触控笔后，手指只用来滚动；接触面特别大的触点直接忽略
      if (e.width > 40 && e.height > 40) return
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touchesRef.current.size >= 2 || penSeenRef.current) {
        // 两指（或笔模式下的手指）= 滚动画布
        if (drawingRef.current && Date.now() - drawingRef.current.startedAt < 250) cancelCurrentStroke()
        const ys = [...touchesRef.current.values()].map((t) => t.y)
        panRef.current = { y: ys.reduce((a, b) => a + b, 0) / ys.length, scroll: scrollYRef.current }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (drawingRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    window.clearTimeout(idleTimer.current)
    const { x, y } = toWorld(e)
    if (toolRef.current === 'eraser') {
      erasedRef.current = []
      drawingRef.current = { pointerId: e.pointerId, stroke: { id: '', points: [], width: 0 }, startedAt: Date.now() }
      eraseAt(x, y)
      return
    }
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    const stroke: Stroke = { id: `${Date.now().toString(36)}-${uid().slice(0, 8)}`, points: [{ x, y, p, t: e.timeStamp }], width: PEN_WIDTH }
    drawingRef.current = { pointerId: e.pointerId, stroke, startedAt: Date.now() }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (panRef.current) {
        const ys = [...touchesRef.current.values()].map((t) => t.y)
        const cy = ys.reduce((a, b) => a + b, 0) / ys.length
        scrollTo(panRef.current.scroll + (panRef.current.y - cy))
        return
      }
    }
    const d = drawingRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
    if (toolRef.current === 'eraser') {
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const { x, y } = toWorld(ev)
        eraseAt(x, y)
      }
      return
    }
    const ctx = canvasRef.current?.getContext('2d')
    const pts = d.stroke.points
    const before = pts.length
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const { x, y } = toWorld(ev)
      const p = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
      smoothAppend(pts, { x, y, p, t: ev.timeStamp } as InkPoint)
    }
    if (ctx && pts.length > before) {
      const { dpr } = sizeRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, -scrollYRef.current * dpr)
      const ink = cssVar('--on-surface', '#1d1d1f')
      ctx.strokeStyle = ink
      ctx.fillStyle = ink
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      drawStroke(ctx, d.stroke, Math.max(1, before - 1))
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') {
      touchesRef.current.delete(e.pointerId)
      if (panRef.current) {
        if (touchesRef.current.size === 0) panRef.current = null
        return
      }
    }
    const d = drawingRef.current
    if (!d || d.pointerId !== e.pointerId) return
    drawingRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (toolRef.current === 'eraser') {
      if (erasedRef.current.length) {
        pushAction({ type: 'erase', strokes: erasedRef.current })
        erasedRef.current = []
        afterChange()
      }
      return
    }
    if (e.type === 'pointercancel') {
      redraw()
      return
    }
    // 平滑会让终点略微滞后，补上真实落点
    const { x, y } = toWorld(e)
    const pts = d.stroke.points
    const last = pts[pts.length - 1]
    if (last && Math.hypot(last.x - x, last.y - y) > 0.5) pts.push({ x, y, p: last.p, t: e.timeStamp })
    strokesRef.current = [...strokesRef.current, d.stroke]
    pushAction({ type: 'add', strokes: [d.stroke] })
    afterChange(d.stroke)
  }

  const onWheel = (e: React.WheelEvent) => {
    scrollTo(scrollYRef.current + e.deltaY)
  }

  /* ---------- 答案浮层 ---------- */

  const overlay: OverlayItem[] = useMemo(() => {
    void version
    const strokes = strokesRef.current
    if (!strokes.length) return []
    const h = estimateCharHeight(strokes)
    const blocks = clusterStrokes(strokes, { charHeight: h })
    const items: OverlayItem[] = []
    for (const block of blocks) {
      const res = resultsRef.current.get(block.key)
      if (!res) continue
      const eq = detectTrailingEquals(strokes.filter((s) => block.strokeIds.includes(s.id)), h)
      const inline = res.result.kind === 'inline' || (res.result.kind === 'error' && eq)
      const a = answerAnchor(block, inline ? eq : null, h)
      items.push({ key: block.key, block, res, x: a.x, y: a.y, fontSize: a.fontSize, placement: a.placement })
    }
    return items
  }, [version])

  const editingBlock = editing ? (resultsRef.current.get(editing) ?? null) : null

  const submitEdit = async (latex: string) => {
    const key = editing
    const engine = engineRef.current
    const current = key ? resultsRef.current.get(key) : null
    if (!key || !engine || !current) return
    setEditBusy(true)
    try {
      // 画布上写了尾部等号、但编辑时把「=」删了：补回去，答案仍写在等号后
      const block = clusterStrokes(strokesRef.current).find((b) => b.key === key)
      const h = estimateCharHeight(strokesRef.current)
      const eq = block ? detectTrailingEquals(strokesRef.current.filter((s) => block.strokeIds.includes(s.id)), h) : null
      const input = eq && !/=\s*$/.test(latex) ? `${latex}=` : latex
      const result = await engine.compute(key, input)
      resultsRef.current.set(key, { ...current, edited: latex, result })
      bump()
      scheduleSave()
      setEditing(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '计算失败')
    } finally {
      setEditBusy(false)
    }
  }

  const resetEdit = async () => {
    const key = editing
    const engine = engineRef.current
    const current = key ? resultsRef.current.get(key) : null
    if (!key || !engine || !current) return
    setEditBusy(true)
    try {
      const result = await engine.compute(key, current.recognized)
      resultsRef.current.set(key, { key, recognized: current.recognized, result })
      bump()
      scheduleSave()
      setEditing(null)
    } finally {
      setEditBusy(false)
    }
  }

  /* ---------- 多页 ---------- */

  const pageIndex = pages.findIndex((p) => p.id === pageId)
  const goPage = (delta: number) => {
    const target = pages[pageIndex + delta]
    if (target) {
      flushSave()
      openPage(target)
    }
  }
  const addPage = async () => {
    flushSave()
    const p = newPage(pages.length + 1)
    await savePage(p)
    setPages((ps) => [...ps, p])
    openPage(p)
  }
  const removePage = async () => {
    const page = pageRef.current
    if (!page) return
    await deletePage(page.id)
    const rest = pages.filter((p) => p.id !== page.id)
    pageRef.current = null
    if (!rest.length) {
      const p = newPage(1)
      await savePage(p)
      setPages([p])
      openPage(p)
    } else {
      setPages(rest)
      openPage(rest[Math.max(0, pageIndex - 1)])
    }
    setDeleteOpen(false)
  }

  /* ---------- 设置 ---------- */

  const applySource = async (cfg: ModelSourceConfig) => {
    setSourceState(cfg)
    engineRef.current?.setSource(cfg)
    await setSource(cfg)
  }

  /* ---------- 视图 ---------- */

  const toolBtn = (active: boolean) =>
    cn(
      'grid place-items-center w-8 h-9 sm:w-9 rounded-[10px] transition-colors cursor-pointer shrink-0 disabled:opacity-35 disabled:cursor-default',
      active ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
    )

  const percent = model.phase === 'loading' && model.ratio >= 0 ? Math.round(model.ratio * 100) : null

  return (
    // AppShell 对本路由开沉浸模式（隐藏全局顶栏 / 底栏，内容区 h-full 不滚动），这里铺满即可。
    // 不用 position: fixed —— 外层路由动画留着 transform，fixed 会相对它而不是视口定位。
    <div
      className="h-full flex flex-col bg-canvas text-on-surface"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* 顶部窄工具栏 */}
      <header className="flex items-center gap-0.5 h-12 px-1.5 border-b border-outline/70 bg-surface/80 backdrop-blur shrink-0">
        <BackButton label="返回工具" onClick={() => navigate('/tools')} />
        <div className="flex items-center min-w-0 mr-auto">
          <button type="button" aria-label="上一页" className={toolBtn(false)} disabled={pageIndex <= 0} onClick={() => goPage(-1)}>
            <ChevronLeft size={17} />
          </button>
          <span className="text-[13px] font-medium tabular-nums px-0.5 whitespace-nowrap">
            {pageIndex >= 0 ? `${pageIndex + 1} / ${pages.length}` : '…'}
          </span>
          <button type="button" aria-label="下一页" className={toolBtn(false)} disabled={pageIndex < 0 || pageIndex >= pages.length - 1} onClick={() => goPage(1)}>
            <ChevronRight size={17} />
          </button>
        </div>
        <button type="button" aria-label="撤销" title="撤销" className={toolBtn(false)} onClick={undo} disabled={!undoRef.current.length}>
          <Undo2 size={17} />
        </button>
        <button type="button" aria-label="重做" title="重做" className={toolBtn(false)} onClick={redo} disabled={!redoRef.current.length}>
          <Redo2 size={17} />
        </button>
        <button type="button" aria-label="笔" title="笔" aria-pressed={tool === 'pen'} className={toolBtn(tool === 'pen')} onClick={() => setTool('pen')}>
          <PenLine size={17} />
        </button>
        <button type="button" aria-label="橡皮" title="橡皮（整笔擦除）" aria-pressed={tool === 'eraser'} className={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')}>
          <Eraser size={17} />
        </button>
        <button type="button" aria-label="显示识别结果" title="显示识别结果（点公式可修改）" aria-pressed={showLatex} className={toolBtn(showLatex)} onClick={() => setShowLatex((v) => !v)}>
          <Sigma size={17} />
        </button>
        {/* modal={false}：从菜单里打开 Dialog 时避免 Radix 残留 pointer-events: none */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="更多" title="更多" className={toolBtn(false)}>
              <MoreHorizontal size={17} />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => void addPage()}>
              <FilePlus2 size={15} /> 新建一页
            </MenuItem>
            <MenuItem onSelect={clearAll}>
              <Trash2 size={15} /> 清空本页
            </MenuItem>
            <MenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings2 size={15} /> 识别设置
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDeleteOpen(true)}>
              <FileX2 size={15} /> 删除本页
            </MenuItem>
          </MenuContent>
        </DropdownMenu>
      </header>

      {/* 画布 */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in srgb, var(--outline) 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--outline) 55%, transparent) 1px, transparent 1px)',
          backgroundSize: `${GRID}px ${GRID}px`,
        }}
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          className={cn('absolute inset-0 touch-none', tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* 答案层：世界坐标，随滚动整体平移；只有答案本身可点 */}
        <div ref={overlayRef} className="absolute inset-0 pointer-events-none" aria-live="polite">
          {overlay.map((it) => (
            <OverlayAnswer key={it.key} item={it} showLatex={showLatex} onOpen={() => setEditing(it.key)} />
          ))}
        </div>

        {!strokesRef.current.length && pageId && (
          <div className="absolute inset-x-0 top-[28%] text-center pointer-events-none px-6">
            <p className="text-[15px] font-medium text-on-surface-2" style={{ fontFamily: HAND_FONT }}>
              在任意位置写下算式，写完「=」就有答案
            </p>
            <p className="text-[12px] text-on-surface-2/80 mt-2 leading-relaxed">
              方程、方程组不写等号，停笔一秒后解会出现在下方 · 双指滑动翻看 · 点答案可修改
            </p>
          </div>
        )}

        {/* 模型状态 */}
        {(model.phase === 'loading' || model.phase === 'error' || recognizing > 0) && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3.5 pointer-events-auto">
            {model.phase === 'loading' ? (
              <div className="card flex items-center gap-2.5 px-3.5 py-2 shadow-lg min-w-[240px]">
                <Loader2 size={14} className="animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium">首次使用，正在下载识别模型{percent != null ? ` ${percent}%` : '…'}</p>
                  <div className="mt-1 h-1 rounded-full bg-surface-3 overflow-hidden">
                    <div className={cn('h-full rounded-full bg-primary transition-[width] duration-200', percent == null && 'w-1/3 animate-pulse')} style={percent != null ? { width: `${percent}%` } : undefined} />
                  </div>
                  <p className="text-[10.5px] text-on-surface-2 mt-1">约 120MB，只下载一次，之后离线可用</p>
                </div>
              </div>
            ) : model.phase === 'error' ? (
              <div className="card flex items-center gap-2 px-3.5 py-2 shadow-lg max-w-[92vw]">
                <p className="text-[12px] text-danger leading-snug min-w-0">{model.message}</p>
                <Button size="sm" variant="outline" className="h-8 px-3 shrink-0" onClick={() => setSettingsOpen(true)}>
                  换下载源
                </Button>
                <Button size="sm" variant="primary" className="h-8 px-3 shrink-0" onClick={() => void loadModel()}>
                  重试
                </Button>
              </div>
            ) : (
              <div className="card flex items-center gap-2 px-3 py-1.5 shadow">
                <Loader2 size={13} className="animate-spin text-primary" />
                <span className="text-[11.5px] text-on-surface-2">识别中…</span>
              </div>
            )}
          </div>
        )}
      </div>

      <MathEditorDialog
        open={Boolean(editingBlock)}
        block={editingBlock}
        busy={editBusy}
        onOpenChange={(v) => {
          if (!v) setEditing(null)
        }}
        onSubmit={(latex) => void submitEdit(latex)}
        onReset={() => void resetEdit()}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen} title="删除这一页？" description="本页的笔迹和识别结果都会删除，无法恢复。">
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" className="h-9 px-4" onClick={() => setDeleteOpen(false)}>
            取消
          </Button>
          <Button variant="destructive" className="h-9 px-4" onClick={() => void removePage()}>
            删除
          </Button>
        </div>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} title="识别设置" description="识别模型 Pix2Text MFR 1.5（MIT 协议）在本机运行，笔迹不上传。">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] font-medium">模型下载源</p>
            <Segmented<ModelSourceId>
              options={MODEL_SOURCES.map((s) => ({ value: s.id, label: s.label }))}
              value={source.preferred}
              onChange={(v) => void applySource({ ...source, preferred: v })}
              size="sm"
              ariaLabel="模型下载源"
            />
            <p className="text-[11.5px] text-on-surface-2">{MODEL_SOURCES.find((s) => s.id === source.preferred)?.hint}；首选源失败会按 GitHub → Hugging Face → hf-mirror 自动换下一个。</p>
            {source.preferred === 'custom' && (
              <input
                value={source.customBase ?? ''}
                onChange={(e) => setSourceState({ ...source, customBase: e.target.value })}
                onBlur={() => void applySource(source)}
                placeholder="https://…/pix2text-mfr-1.5（目录下放 encoder_model.onnx、decoder_model.onnx、tokenizer.json）"
                className="h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[12.5px] outline-none focus:border-primary/60"
              />
            )}
          </div>
          <div className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12px] text-on-surface-2 leading-relaxed">
            {model.phase === 'ready' && <>模型已就绪 · 推理后端 {model.backend === 'webgpu' ? 'WebGPU' : 'WASM（CPU）'}</>}
            {model.phase === 'loading' && <>正在下载 {model.file || '模型'}{percent != null ? ` · ${percent}%` : ''}</>}
            {model.phase === 'error' && <span className="text-danger">{model.message}</span>}
            {model.phase === 'idle' && <>模型未加载</>}
          </div>
          <div className="flex justify-end gap-2">
            {model.phase !== 'ready' && model.phase !== 'loading' && (
              <Button variant="primary" className="h-9 px-4" onClick={() => void loadModel()}>
                下载 / 加载模型
              </Button>
            )}
            <Button variant="outline" className="h-9 px-4" onClick={() => setSettingsOpen(false)}>
              完成
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

/** 单个算式块的答案 / 解 / 报错标记 / 识别原文 */
function OverlayAnswer({ item, showLatex, onOpen }: { item: OverlayItem; showLatex: boolean; onOpen: () => void }) {
  const { res, block } = item
  const r = res.result
  const latexChip = showLatex ? (
    <button
      type="button"
      onClick={onOpen}
      className="absolute pointer-events-auto cursor-pointer rounded-[8px] bg-surface/90 border border-outline px-1.5 py-0.5 text-[12px] text-on-surface-2 shadow-sm max-w-[80vw] overflow-hidden"
      style={{ left: block.box.minX, top: block.box.minY - 6, transform: 'translateY(-100%)' }}
      title="点击修改识别结果"
    >
      <MathView latex={res.edited ?? res.recognized} />
    </button>
  ) : null

  if (r.kind === 'none') return latexChip

  if (r.kind === 'error') {
    return (
      <>
        {latexChip}
        <button
          type="button"
          onClick={onOpen}
          title={r.message}
          aria-label={`没算出来：${r.message ?? ''}，点击修改`}
          className="absolute pointer-events-auto cursor-pointer grid place-items-center rounded-full border-2 font-bold"
          style={{
            left: item.placement === 'inline' ? item.x : block.box.maxX + 10,
            top: item.placement === 'inline' ? item.y : (block.box.minY + block.box.maxY) / 2,
            width: 26,
            height: 26,
            transform: 'translateY(-50%)',
            borderColor: ANSWER_COLOR,
            color: ANSWER_COLOR,
            fontSize: 15,
          }}
        >
          ?
        </button>
      </>
    )
  }

  const inline = item.placement === 'inline'
  const simpleText = r.text && !/[\\{}]/.test(r.text)
  return (
    <>
      {latexChip}
      <button
        type="button"
        onClick={onOpen}
        title="点击修改"
        className="absolute pointer-events-auto cursor-pointer text-left leading-none whitespace-nowrap"
        style={{
          left: item.x,
          // 写在等号后：与等号中线对齐；写在下方：从块底下往下排，多行解不会盖住算式
          top: inline ? item.y : item.y - item.fontSize / 2,
          transform: inline ? 'translateY(-50%)' : undefined,
          color: ANSWER_COLOR,
          fontSize: item.fontSize,
          fontFamily: HAND_FONT,
        }}
      >
        {simpleText ? <span>{r.text}</span> : <MathView latex={r.latex} />}
        {r.alt && (
          <span className="ml-2 opacity-80" style={{ fontSize: Math.max(13, item.fontSize * 0.5) }}>
            ≈ {r.alt}
          </span>
        )}
      </button>
    </>
  )
}
