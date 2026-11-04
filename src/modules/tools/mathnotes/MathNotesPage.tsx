import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { ChevronLeft, ChevronRight, Eraser, FilePlus2, FileX2, Loader2, MoreHorizontal, PenLine, Redo2, Settings2, Sigma, Trash2, Undo2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuSeparator } from '@/shared/ui/Menu'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { BackButton } from '@/shared/ui/BackButton'
import { clusterStrokes, columnRows, detectTrailingEquals, estimateAnswerWidth, estimateCharHeight, fitAnswer, pressureWidth, smoothAppend, strokeBox, strokesHitBy } from './geometry'
import { PointerGesture } from './pointerGesture'
import { RecognitionQueue } from './recognitionQueue'
import { MathEngine } from './mathEngine'
import { MathView } from './MathView'
import { manualExpression } from './mathText'
import { MathEditorDialog } from './MathEditorDialog'
import { MODEL_SOURCES, DEFAULT_SOURCE, type ModelSourceConfig, type ModelSourceId } from './recognizer'
import { createPage, deletePage, getLastPageId, getSource, listPages, newPage, setLastPageId, setSource } from './store'
import { NoteSession, type EditKind } from './noteSession'
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
  /** 识别结果；识别失败时为空，此时 failed 是失败原因 */
  res: BlockResult | null
  failed?: string
  x: number
  y: number
  fontSize: number
  placement: 'inline' | 'below'
  fontWeight?: number
  canCorrect?: boolean
  /** 答案比可视宽度还宽时限宽（答案自身横向滚动） */
  maxWidth?: number
}

interface RecognizeJob {
  key: string
  pageId: string
  strokes: Stroke[]
  charHeight: number
}

/** 识别失败标记 / 「?」标记的宽度 */
const MARK_WIDTH = 26
const FAIL_MARK_WIDTH = 184

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
 * 笔迹和识别结果存本机 IndexedDB（mathNotes 表），支持多页；随 JSON 备份 / 自动快照 / WebDAV 同步走。
 */
export function MathNotesPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MathEngine | null>(null)

  // 页列表直接订阅库：同步进来的新页 / 删掉的页 / 冲突副本都会自动出现在翻页里
  const pages = useLiveQuery(listPages, [], [] as MathNotePage[])
  const [pageId, setPageId] = useState<string>('')
  const pageRef = useRef<MathNotePage | null>(null)
  /** 当前页与库之间的保存状态（dirty / baseline / 冲突处理），见 noteSession.ts */
  const sessionRef = useRef<NoteSession | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const resultsRef = useRef<Map<string, BlockResult>>(new Map())
  const undoRef = useRef<Action[]>([])
  const redoRef = useRef<Action[]>([])
  const queueRef = useRef<RecognitionQueue<RecognizeJob> | null>(null)
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
  const [manualFallback, setManualFallback] = useState<BlockResult | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [recognizing, setRecognizing] = useState(0)
  const [viewW, setViewW] = useState(0)
  /** 答案元素实测宽度（key → CSS 像素），用于判断等号右侧放不放得下 */
  const [answerWidths, setAnswerWidths] = useState<Map<string, number>>(() => new Map())

  const scrollYRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const idleTimer = useRef<number | undefined>(undefined)
  const saveTimer = useRef<number | undefined>(undefined)

  /* ---------- 模型 ---------- */

  const onModelProgress = useCallback((ratio: number, file: string) => {
    setModel({ phase: 'loading', ratio, file })
  }, [])

  /** fresh：用户点了「重试」或在识别设置里点「重新加载模型」——释放会话并清掉未通过校验的缓存文件，只补下缺的 / 坏的 */
  const loadModel = useCallback(async (opts: { fresh?: boolean } = {}) => {
    const engine = engineRef.current
    if (!engine) return
    setModel({ phase: 'loading', ratio: 0, file: '' })
    try {
      const backend = await engine.load(onModelProgress, opts)
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

  /** 当前编辑器内容（只保留还对得上笔画的识别结果） */
  const currentDraft = useCallback(() => {
    const keys = new Set(clusterStrokes(strokesRef.current).map((b) => b.key))
    return {
      strokes: strokesRef.current,
      results: [...resultsRef.current.values()].filter((r) => keys.has(r.key)),
    }
  }, [])

  /** 有改动才写库（乐观并发，见 noteSession.ts）；没编辑过什么都不写 */
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const session = sessionRef.current
    if (!session?.isDirty) return
    void session.save().catch(() => undefined)
  }, [])

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(flushSave, 600)
  }, [flushSave])

  /** 记一次改动：user = 用户亲手改的；derived = 自动识别写回的结果 */
  const markEdited = useCallback(
    (kind: EditKind) => {
      sessionRef.current?.markEdited(kind)
      scheduleSave()
    },
    [scheduleSave],
  )

  /** 把一页内容装进编辑器（换页、或库里的新版本替换当前内容） */
  const loadIntoEditor = useCallback(
    (page: MathNotePage, opts: { keepScroll?: boolean } = {}) => {
      pageRef.current = page
      strokesRef.current = page.strokes.map((s) => ({ ...s, points: [...s.points] }))
      resultsRef.current = new Map(page.results.map((r) => [r.key, r]))
      // 撤销栈指向的是旧内容，换了内容就作废
      undoRef.current = []
      redoRef.current = []
      queueRef.current?.submit([])
      if (!opts.keepScroll) scrollYRef.current = 0
      bump()
    },
    [bump],
  )

  /** 本页在别处被删（同步来的墓碑）：换到别的页，没页了就新建一页 */
  const onCurrentDeletedRef = useRef<() => void>(() => undefined)

  const openPage = useCallback(
    (page: MathNotePage) => {
      const prev = sessionRef.current
      if (prev && prev.id !== page.id) {
        window.clearTimeout(saveTimer.current)
        void prev.close().catch(() => undefined)
      }
      const session = new NoteSession(page, currentDraft, {
        onReplaced: (latest) => {
          if (sessionRef.current !== session) return
          loadIntoEditor(latest, { keepScroll: true })
          toast('这一页已更新为其他设备同步来的版本')
        },
        onConflict: (copy) => {
          toast(`这一页在其他设备上也改过：你的修改已另存为「${copy.title}」，原页保留同步来的版本`)
          // 已换页 / 已离开时只提示；还在这一页就切到副本继续写
          if (sessionRef.current !== session) return
          pageRef.current = copy
          setPageId(copy.id)
          setLastPageId(copy.id)
        },
        onDeleted: () => {
          if (sessionRef.current !== session) return
          onCurrentDeletedRef.current()
        },
        onError: () => toast('笔记保存失败'),
      })
      sessionRef.current = session
      loadIntoEditor(page)
      setPageId(page.id)
      setLastPageId(page.id)
    },
    [currentDraft, loadIntoEditor, toast],
  )

  useEffect(() => {
    let alive = true
    void listPages().then(async (rows) => {
      if (!alive) return
      let list = rows
      if (!list.length) {
        const first = newPage(1)
        await createPage(first)
        list = [first]
      }
      const last = getLastPageId()
      openPage(list.find((p) => p.id === last) ?? list[list.length - 1])
    })
    return () => {
      alive = false
    }
    // 只在进入页面时加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开期间监听库里这一页：同步写进来的新版本在本地没编辑时自动刷新，编辑过则另存冲突副本
  useEffect(() => {
    if (!pageId) return
    const sub = liveQuery(() => db.mathNotes.get(pageId)).subscribe({
      next: (row) => {
        const session = sessionRef.current
        if (session && session.id === pageId) void session.onExternal(row).catch(() => undefined)
      },
      error: () => undefined,
    })
    return () => sub.unsubscribe()
  }, [pageId])

  // 离开页面：有改动才保存，没编辑过不写库
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
      void sessionRef.current?.close().catch(() => undefined)
    },
    [],
  )

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
      setViewW(rect.width)
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

  const getQueue = useCallback((): RecognitionQueue<RecognizeJob> => {
    if (queueRef.current) return queueRef.current
    const q = new RecognitionQueue<RecognizeJob>(
      async (job) => {
        const engine = engineRef.current
        if (!engine) throw new DOMException('已取消', 'AbortError')
        const r = await engine.recognize(job.key, job.strokes, job.charHeight, onModelProgress)
        // 模型若是在这次识别里顺带加载完的，状态条也要收起来
        setModel((m) => (m.phase === 'ready' ? m : { phase: 'ready', backend: engine.backend ?? 'wasm' }))
        if (pageRef.current?.id !== job.pageId) return
        // 识别期间笔画变了（key 不在了）就丢弃，最新版本已在队列里
        const still = clusterStrokes(strokesRef.current).some((b) => b.key === job.key)
        if (!still) return
        resultsRef.current.set(job.key, { key: job.key, recognized: r.latex, result: r.result })
        bump()
        markEdited('derived')
      },
      {
        onChange: () => {
          setRecognizing(queueRef.current?.busy ?? 0)
          bump()
        },
        onError: (_job, e) => {
          // 模型下载阶段的失败仍走底部的「换下载源 / 重试」条；块上同时有 ⚠ 标记可单独重试
          const message = e instanceof Error ? e.message : '识别失败'
          setModel((m) => (m.phase === 'loading' ? { phase: 'error', message } : m))
        },
      },
    )
    queueRef.current = q
    return q
  }, [bump, onModelProgress, markEdited])

  useEffect(
    () => () => {
      queueRef.current?.dispose()
      queueRef.current = null
    },
    [],
  )

  /** 把当前笔迹下所有未识别的块（最新版本）交给队列；过时的排队请求被替换掉 */
  const runRecognition = useCallback(() => {
    const page = pageRef.current
    if (!engineRef.current || !page) return
    const strokes = strokesRef.current
    const h = estimateCharHeight(strokes)
    const blocks = clusterStrokes(strokes, { charHeight: h })
    const jobs: RecognizeJob[] = []
    for (const block of blocks) {
      if (resultsRef.current.has(block.key)) continue
      jobs.push({ key: block.key, pageId: page.id, strokes: strokes.filter((s) => block.strokeIds.includes(s.id)), charHeight: h })
    }
    getQueue().submit(jobs)
  }, [getQueue])

  const retryBlock = useCallback(
    (key: string) => {
      getQueue().retry(key)
      runRecognition()
    },
    [getQueue, runRecognition],
  )

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
      markEdited('user')
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
    [bump, scheduleRecognition, markEdited],
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

  /** 进行中的书写（笔 / 橡皮）；手势判定交给 PointerGesture 状态机 */
  const drawingRef = useRef<{ pointerId: number; stroke: Stroke } | null>(null)
  const erasedRef = useRef<Stroke[]>([])
  const gestureRef = useRef(new PointerGesture())
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

  const eraseAt = (x: number, y: number) => {
    const hit = new Set(strokesHitBy(strokesRef.current, x, y, ERASER_RADIUS))
    if (!hit.size) return
    erasedRef.current.push(...strokesRef.current.filter((s) => hit.has(s.id)))
    strokesRef.current = strokesRef.current.filter((s) => !hit.has(s.id))
    redraw()
  }

  /**
   * 结束进行中的书写。commit：笔画入库（橡皮则提交擦除）；discard：丢弃笔画（橡皮擦掉的仍提交，免得「擦了又没记录」）。
   * 不论哪种，绘制状态都清空，后续触摸不会被当成仍在书写而忽略。
   */
  const finishDrawing = (end: 'commit' | 'discard', last?: { x: number; y: number; t: number }) => {
    const d = drawingRef.current
    drawingRef.current = null
    // 不主动释放指针捕获：被第二指打断时这根手指还按着、要参与滚动；抬起时浏览器会自动释放
    if (!d) return
    if (toolRef.current === 'eraser' || !d.stroke.id) {
      if (erasedRef.current.length) {
        pushAction({ type: 'erase', strokes: erasedRef.current })
        erasedRef.current = []
        afterChange()
      }
      return
    }
    const pts = d.stroke.points
    if (end === 'discard' || !pts.length) {
      redraw()
      return
    }
    // 平滑会让终点略微滞后，补上真实落点
    const tail = pts[pts.length - 1]
    if (last && tail && Math.hypot(tail.x - last.x, tail.y - last.y) > 0.5) pts.push({ x: last.x, y: last.y, p: tail.p, t: last.t })
    strokesRef.current = [...strokesRef.current, d.stroke]
    pushAction({ type: 'add', strokes: [d.stroke] })
    afterChange(d.stroke)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const kind = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse'
    const r = gestureRef.current.down({
      id: e.pointerId,
      kind,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      button: e.button,
      // 手掌误触：接触面特别大的触点直接忽略
      palm: kind === 'touch' && e.width > 40 && e.height > 40,
    })
    if (r.action === 'ignore') return
    if (r.action === 'pan') {
      // 两指（或笔模式下的手指）= 滚动画布；进行中的笔画必须结束
      if (r.interrupted && drawingRef.current?.pointerId === r.interrupted.pointerId) finishDrawing(r.interrupted.end)
      panRef.current = { y: r.centerY, scroll: scrollYRef.current }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    window.clearTimeout(idleTimer.current)
    const { x, y } = toWorld(e)
    if (toolRef.current === 'eraser') {
      erasedRef.current = []
      drawingRef.current = { pointerId: e.pointerId, stroke: { id: '', points: [], width: 0 } }
      eraseAt(x, y)
      return
    }
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    const stroke: Stroke = { id: `${Date.now().toString(36)}-${uid().slice(0, 8)}`, points: [{ x, y, p, t: e.timeStamp }], width: PEN_WIDTH }
    drawingRef.current = { pointerId: e.pointerId, stroke }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current
    const m = g.move(e.pointerId, e.clientX, e.clientY)
    if (m && panRef.current) {
      scrollTo(panRef.current.scroll + (panRef.current.y - m.panCenterY))
      return
    }
    const d = drawingRef.current
    if (!d || d.pointerId !== e.pointerId || !g.isDrawing(e.pointerId)) return
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

  /** pointerup / pointercancel / lostpointercapture 共用 */
  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cancelled = e.type !== 'pointerup'
    const r = gestureRef.current.up(e.pointerId, cancelled)
    if (r.action === 'panRebase') {
      panRef.current = { y: r.centerY, scroll: scrollYRef.current }
    } else if (r.action === 'endPan') {
      panRef.current = null
    } else if (r.action === 'endDraw' && drawingRef.current?.pointerId === e.pointerId) {
      finishDrawing(r.end, r.end === 'commit' ? { ...toWorld(e), t: e.timeStamp } : undefined)
    }
    // 状态机已完全复位但页面这边还残留书写 / 滚动状态：一并清掉（兜底，避免画布卡死）
    if (gestureRef.current.mode === 'idle') {
      if (drawingRef.current) finishDrawing('discard')
      panRef.current = null
    }
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
    const queue = queueRef.current
    const items: OverlayItem[] = []
    for (const block of blocks) {
      const res = resultsRef.current.get(block.key) ?? null
      const failed = res ? undefined : queue?.failureOf(block.key)
      if (!res && !failed) continue
      const blockStrokes = strokes.filter((s) => block.strokeIds.includes(s.id))
      const blockHeight = estimateCharHeight(blockStrokes, h)
      const column = columnRows(blockStrokes, blockHeight)
      const eq = column ? null : detectTrailingEquals(blockStrokes, blockHeight)
      const r = res?.result
      const canCorrect = r?.kind === 'none' && Boolean(eq || column)
      const isMark = !r || r.kind === 'error' || canCorrect
      const inline = r?.kind === 'inline' || (isMark && eq)
      // 标记（? / ⚠）没有尾部等号时放在块右侧中线；放不下同样换到下方
      const anchorEq = inline ? eq : isMark ? { box: { ...block.box, maxX: block.box.maxX + 10 - h * 0.3 }, midY: (block.box.minY + block.box.maxY) / 2 } : null
      const fontSize = Math.round(Math.min(96, Math.max(18, blockHeight * 0.95)))
      const measured = answerWidths.get(block.key)
      const width = !r ? FAIL_MARK_WIDTH : r.kind === 'error' ? MARK_WIDTH : (measured ?? estimateAnswerWidth(plainOf(r.text || r.latex), anchorEq ? fontSize : Math.round(fontSize * 0.75), r.alt))
      const a = fitAnswer(block, anchorEq, blockHeight, { answerWidth: width, viewWidth: viewW, alignRight: Boolean(column) && !isMark })
      const penWidth = blockStrokes.reduce((sum, stroke) => sum + stroke.width, 0) / Math.max(1, blockStrokes.length)
      const fontWeight = Math.max(400, Math.min(600, Math.round((penWidth / blockHeight) * 3000 / 100) * 100 + 300))
      items.push({ key: block.key, block, res, failed, x: a.x, y: a.y, fontSize: a.fontSize, fontWeight, canCorrect, placement: a.placement, maxWidth: a.maxWidth })
    }
    return items
  }, [version, viewW, answerWidths])

  const onMeasure = useCallback((key: string, width: number) => {
    setAnswerWidths((prev) => {
      const old = prev.get(key)
      if (old != null && Math.abs(old - width) < 1) return prev
      const next = new Map(prev)
      next.set(key, width)
      // 只保留当前还在的块，避免无限增长
      if (next.size > 400) for (const k of [...next.keys()].slice(0, next.size - 400)) next.delete(k)
      return next
    })
  }, [])

  const editingBlock = editing ? (resultsRef.current.get(editing) ?? (manualFallback?.key === editing ? manualFallback : null)) : null

  const openManual = (key: string) => {
    setManualFallback({ key, recognized: '', result: { kind: 'error', latex: '', text: '', message: '未能识别，请直接输入算式' } })
    setEditing(key)
  }

  const submitEdit = async (latex: string) => {
    const key = editing
    const engine = engineRef.current
    const original = key ? resultsRef.current.get(key) : undefined
    const current = original ?? (manualFallback?.key === key ? manualFallback : undefined)
    if (!key || !engine || !current) return
    const editingPage = pageRef.current?.id
    setEditBusy(true)
    try {
      // 画布上写了尾部等号、但编辑时把「=」删了：补回去，答案仍写在等号后
      const block = clusterStrokes(strokesRef.current).find((b) => b.key === key)
      const h = estimateCharHeight(strokesRef.current)
      const eq = block ? detectTrailingEquals(strokesRef.current.filter((s) => block.strokeIds.includes(s.id)), h) : null
      const column = block ? columnRows(strokesRef.current.filter((s) => block.strokeIds.includes(s.id)), h) : null
      const input = manualExpression(latex, Boolean(eq || column))
      const result = await engine.compute(key, input)
      if (pageRef.current?.id !== editingPage || !clusterStrokes(strokesRef.current).some(b => b.key === key) || resultsRef.current.get(key) !== original) return
      getQueue().retry(key)
      resultsRef.current.set(key, { ...current, edited: latex, result })
      bump()
      markEdited('user')
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
    const editingPage = pageRef.current?.id
    setEditBusy(true)
    try {
      const result = await engine.compute(key, current.recognized)
      if (pageRef.current?.id !== editingPage || !clusterStrokes(strokesRef.current).some(b => b.key === key) || resultsRef.current.get(key) !== current) return
      resultsRef.current.set(key, { key, recognized: current.recognized, result })
      bump()
      markEdited('user')
      setEditing(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '计算失败')
    } finally {
      setEditBusy(false)
    }
  }

  /* ---------- 多页 ---------- */

  const pageIndex = pages.findIndex((p) => p.id === pageId)
  const goPage = (delta: number) => {
    const target = pages[pageIndex + delta]
    if (target) openPage(target)
  }
  const addPage = async () => {
    const p = newPage(pages.length + 1)
    await createPage(p)
    openPage(p)
  }
  /** 换到 id 之外的某一页（优先原位置的前一页）；一页不剩就新建 */
  const openNeighbourOf = async (id: string, index: number) => {
    const rest = (await listPages()).filter((p) => p.id !== id)
    if (!rest.length) {
      const p = newPage(1)
      await createPage(p)
      openPage(p)
    } else {
      openPage(rest[Math.max(0, Math.min(rest.length - 1, index - 1))])
    }
  }
  onCurrentDeletedRef.current = () => {
    const id = pageRef.current?.id
    if (!id) return
    toast('这一页已在其他设备上删除')
    sessionRef.current = null
    void openNeighbourOf(id, pageIndex)
  }
  const removePage = async () => {
    const page = pageRef.current
    if (!page) return
    window.clearTimeout(saveTimer.current)
    // 主动删除：本页未保存的改动随之作废，不再写库
    sessionRef.current = null
    pageRef.current = null
    await deletePage(page.id)
    await openNeighbourOf(page.id, pageIndex)
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
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* 答案层：世界坐标，随滚动整体平移；只有答案本身可点 */}
        <div ref={overlayRef} className="absolute inset-0 pointer-events-none" aria-live="polite">
          {overlay.map((it) => (
            <OverlayAnswer
              key={it.key}
              item={it}
              showLatex={showLatex}
              onOpen={() => setEditing(it.key)}
              onRetry={() => retryBlock(it.key)}
              onManual={() => openManual(it.key)}
              onMeasure={onMeasure}
            />
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
                <Button size="sm" variant="primary" className="h-8 px-3 shrink-0" onClick={() => void loadModel({ fresh: true })}>
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
              <Button variant="primary" className="h-9 px-4" onClick={() => void loadModel({ fresh: true })}>
                重新加载模型
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

/** LaTeX → 粗略的可见字符（估宽用） */
function plainOf(latex: string): string {
  return latex.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\\]/g, '')
}

/** 单个算式块的答案 / 解 / 报错标记 / 识别失败标记 / 识别原文 */
export function OverlayAnswer({
  item,
  showLatex,
  onOpen,
  onRetry,
  onManual,
  onMeasure,
}: {
  item: OverlayItem
  showLatex: boolean
  onOpen: () => void
  onRetry: () => void
  onManual?: () => void
  onMeasure: (key: string, width: number) => void
}) {
  const { res, block } = item
  const r = res?.result
  const answerRef = useRef<HTMLButtonElement>(null)
  // 实测答案宽度（scrollWidth 不受 maxWidth 限制），右侧放不下时改放下方
  useLayoutEffect(() => {
    const el = answerRef.current
    if (el) onMeasure(item.key, el.scrollWidth)
  })

  const latexChip =
    showLatex && res ? (
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

  if (!r) {
    // 失败后可重试，也可以绕过识别直接输入算式。
    return (
      <div className="absolute pointer-events-auto flex items-center gap-1 rounded-full border border-danger/60 bg-surface/95 px-2 py-1 shadow-sm text-[12px] text-danger whitespace-nowrap"
        style={{ left: item.x, top: item.y, transform: 'translateY(-50%)', maxWidth: item.maxWidth }}>
        <button type="button" onClick={onRetry} title={`识别失败：${item.failed ?? ''}（点击重试）`}
          aria-label={`识别失败：${item.failed ?? ''}，点击重试`} data-testid="mathnotes-recognize-failed">⚠ 重试</button>
        {onManual && <button type="button" onClick={onManual} aria-label="手动输入算式" className="rounded-full px-1.5 text-on-surface">手动输入</button>}
      </div>
    )
  }

  if (r.kind === 'none' && !item.canCorrect) return latexChip

  if (r.kind === 'error' || (r.kind === 'none' && item.canCorrect)) {
    return (
      <>
        {latexChip}
        <button
          type="button"
          onClick={onOpen}
          title={r.message ?? '点击修改识别内容'}
          aria-label={r.kind === 'none' ? '未算出结果，点击修改识别内容' : `没算出来：${r.message ?? ''}，点击修改`}
          className="absolute pointer-events-auto cursor-pointer grid place-items-center rounded-full border-2 font-bold"
          style={{
            left: item.x,
            top: item.y,
            width: MARK_WIDTH,
            height: MARK_WIDTH,
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
        ref={answerRef}
        type="button"
        onClick={onOpen}
        title="点击修改"
        className={cn('absolute pointer-events-auto cursor-pointer text-left leading-none whitespace-nowrap', item.maxWidth != null && 'overflow-x-auto overflow-y-hidden')}
        style={{
          left: item.x,
          // 写在等号后：与等号中线对齐；写在下方：从块底下往下排，多行解不会盖住算式
          top: inline ? item.y : item.y - item.fontSize / 2,
          transform: inline ? 'translateY(-50%)' : undefined,
          maxWidth: item.maxWidth,
          color: 'var(--on-surface)',
          fontSize: item.fontSize,
          fontWeight: item.fontWeight,
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
