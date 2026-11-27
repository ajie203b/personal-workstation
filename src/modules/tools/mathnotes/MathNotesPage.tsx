import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { clusterStrokes, columnRows, detectTrailingEquals, estimateAnswerWidth, estimateCharHeight, findGraphPlacement, fitAnswer, layoutOverlayItems, strokeBox, unionBox } from './geometry'
import { transformStrokes } from './lasso'
import { normalizeLatex } from './latexNormalize'
import { manualExpression } from './mathText'
import { createPage, deletePage, getLastPageId, listPages, newPage, setLastPageId } from './store'
import { NoteSession, type EditKind } from './noteSession'
import { FAIL_MARK_WIDTH, GRID, HAND_FONT, MARK_WIDTH, PEN_WIDTH, cssVar, drawStroke, plainOf, resolveStrokeColor, type Action, type OverlayItem, type PenColorId, type Tool } from './canvasDraw'
import { EmbeddedGraphLayer, LassoSelectionOverlay, ModelStatusBanner, OverlayAnswer } from './MathNotesOverlay'
import { MathNotesToolbar } from './MathNotesToolbar'
import { MathNotesDialogs } from './MathNotesDialogs'
import { synthFormulaStrokes } from './synthInk'
import { useCanvasPointer } from './useCanvasPointer'
import { useMathRecognition } from './useMathRecognition'
import type { AngleMode, BlockResult, MathNotePage, NoteGraph, Stroke } from './types'
import { openSavedAction, saveBlob } from '@/lib/saveFile'
import { uid } from '@/lib/id'

export { OverlayAnswer }

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

  // 页列表直接订阅库：同步进来的新页 / 删掉的页 / 冲突副本都会自动出现在翻页里
  const pages = useLiveQuery(listPages, [], [] as MathNotePage[])
  const [pageId, setPageId] = useState<string>('')
  const pageRef = useRef<MathNotePage | null>(null)
  /** 当前页与库之间的保存状态（dirty / baseline / 冲突处理），见 noteSession.ts */
  const sessionRef = useRef<NoteSession | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const graphsRef = useRef<NoteGraph[]>([])
  const graphDrag = useRef<{ id: string; pointerId: number; x: number; y: number; original: NoteGraph } | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const lassoRef = useRef<{ pointerId: number; points: {x: number; y: number}[] } | null>(null)
  const selectionDrag = useRef<{ pointerId: number; x: number; y: number; before: Stroke[] } | null>(null)
  const resultsRef = useRef<Map<string, BlockResult>>(new Map())
  const undoRef = useRef<Action[]>([])
  const redoRef = useRef<Action[]>([])
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const [tool, setTool] = useState<Tool>('pen')
  const toolRef = useRef<Tool>('pen')
  toolRef.current = tool
  const [penColor, setPenColor] = useState<PenColorId>('auto')
  const penColorRef = useRef<string>('auto')
  penColorRef.current = penColor
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTH)
  const penWidthRef = useRef<number>(PEN_WIDTH)
  penWidthRef.current = penWidth
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const [penLocked, setPenLocked] = useState(false)
  const [showLatex, setShowLatex] = useState(false)
  const [resultMode, setResultMode] = useState<'auto' | 'suggest' | 'off'>('auto')
  const [angleMode, setAngleMode] = useState<AngleMode>('rad')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  useEffect(() => {
    void db.settings.get('mathNotesResultMode').then(row => { if (row?.value === 'auto' || row?.value === 'suggest' || row?.value === 'off') setResultMode(row.value) })
    void db.settings.get('mathNotesAngleMode').then(row => { if (row?.value === 'rad' || row?.value === 'deg') setAngleMode(row.value) })
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [plotOpen, setPlotOpen] = useState(false)
  const [plotInput, setPlotInput] = useState('y=x^2')
  const [plotSource, setPlotSource] = useState<string | undefined>()
  const [plotGraphId, setPlotGraphId] = useState<string | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [manualFallback, setManualFallback] = useState<BlockResult | null>(null)
  const [creatingManual, setCreatingManual] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [viewW, setViewW] = useState(0)
  /** 答案元素实测宽度（key → CSS 像素），用于判断等号右侧放不放得下 */
  const [answerWidths, setAnswerWidths] = useState<Map<string, number>>(() => new Map())

  const scrollXRef = useRef(0)
  const scrollYRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const idleTimer = useRef<number | undefined>(undefined)
  const saveTimer = useRef<number | undefined>(undefined)

  /* ---------- 页面数据 ---------- */

  /** 当前编辑器内容（只保留还对得上笔画的识别结果） */
  const currentDraft = useCallback(() => {
    const keys = new Set(clusterStrokes(strokesRef.current).map((b) => b.key))
    return {
      strokes: strokesRef.current,
      graphs: graphsRef.current,
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

  const {
    engineRef,
    queueRef,
    model,
    source,
    setSourceState,
    recognizing,
    pageVariables,
    evaluateEntriesNow,
    plotFunction,
    loadModel,
    getQueue,
    retryBlock,
    afterChange,
    applySource,
    resetEvaluation,
  } = useMathRecognition({
    pageId,
    version,
    angleMode,
    pageRef,
    strokesRef,
    graphsRef,
    resultsRef,
    idleTimer,
    bump,
    markEdited,
    setRevealed,
  })

  /** 把一页内容装进编辑器（换页、或库里的新版本替换当前内容） */
  const loadIntoEditor = useCallback(
    (page: MathNotePage, opts: { keepScroll?: boolean } = {}) => {
      pageRef.current = page
      setSelected([])
      setRevealed(new Set())
      resetEvaluation()
      graphsRef.current = page.graphs?.map(graph => ({ ...graph })) ?? []
      strokesRef.current = page.strokes.map((s) => ({ ...s, points: [...s.points] }))
      resultsRef.current = new Map(page.results.map((r) => [r.key, r]))
      // 撤销栈指向的是旧内容，换了内容就作废
      undoRef.current = []
      redoRef.current = []
      if (!opts.keepScroll) {
        scrollXRef.current = 0
        scrollYRef.current = 0
      }
      bump()
    },
    [bump, resetEvaluation],
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

  // 离开页面 / 切到后台 / 关闭标签页：有改动才保存，没编辑过不写库
  useEffect(() => {
    const flush = () => {
      window.clearTimeout(saveTimer.current)
      void sessionRef.current?.save().catch(() => undefined)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      window.clearTimeout(saveTimer.current)
      void sessionRef.current?.close().catch(() => undefined)
    }
  }, [])

  /* ---------- 编辑操作 ---------- */

  const pushAction = (a: Action) => {
    undoRef.current.push(a)
    if (undoRef.current.length > 200) undoRef.current.shift()
    redoRef.current = []
  }

  const undo = useCallback(() => {
    const a = undoRef.current.pop()
    if (!a) return
    if (a.type === 'graphs') { graphsRef.current = a.before
    } else if (a.type === 'move') {
      const map = new Map(a.before.map(stroke => [stroke.id, stroke]))
      strokesRef.current = strokesRef.current.map(stroke => map.get(stroke.id) ?? stroke)
    } else if (a.type === 'add') {
      const ids = new Set(a.strokes.map((s) => s.id))
      strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id))
    } else {
      strokesRef.current = [...strokesRef.current, ...a.strokes]
      if (a.type === 'clear' && a.graphs) graphsRef.current = a.graphs
    }
    redoRef.current.push(a)
    afterChange()
  }, [afterChange])

  const redo = useCallback(() => {
    const a = redoRef.current.pop()
    if (!a) return
    if (a.type === 'graphs') { graphsRef.current = a.after
    } else if (a.type === 'move') {
      const map = new Map(a.after.map(stroke => [stroke.id, stroke]))
      strokesRef.current = strokesRef.current.map(stroke => map.get(stroke.id) ?? stroke)
    } else if (a.type === 'add') strokesRef.current = [...strokesRef.current, ...a.strokes]
    else {
      const ids = new Set(a.strokes.map((s) => s.id))
      strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id))
      if (a.type === 'clear' && a.graphs) graphsRef.current = []
    }
    undoRef.current.push(a)
    afterChange()
  }, [afterChange])

  const clearAll = () => {
    if (!strokesRef.current.length && !graphsRef.current.length) return
    pushAction({ type: 'clear', strokes: strokesRef.current, graphs: graphsRef.current })
    strokesRef.current = []
    graphsRef.current = []
    setSelected([])
    resultsRef.current.clear()
    afterChange()
    toast('已清空本页，可点撤销找回')
  }

  // 撤销重做快捷键已合并进上方的全套快捷键监听中。

  /* ---------- 指针输入 ---------- */

  const { zoomAt, unlockFinger, onPointerDown, onPointerMove, onPointerEnd } = useCanvasPointer({
    containerRef,
    canvasRef,
    overlayRef,
    strokesRef,
    graphsRef,
    lassoRef,
    scrollXRef,
    scrollYRef,
    zoomRef,
    penColorRef,
    penWidthRef,
    sizeRef,
    idleTimer,
    toolRef,
    setSelected,
    setViewW,
    onZoomChange: setZoom,
    onPenLockChange: setPenLocked,
    version,
    pushAction,
    afterChange,
  })

  const selectionStrokes = strokesRef.current.filter(s => selected.includes(s.id))
  const selectionBox = selectionStrokes.length ? selectionStrokes.map(strokeBox).reduce(unionBox) : null
  const changeSelection = (scale: number) => {
    if (!selectionBox || !selectionStrokes.length) return
    const ids = new Set(selected), before = selectionStrokes
    const center = { x: (selectionBox.minX + selectionBox.maxX) / 2, y: (selectionBox.minY + selectionBox.maxY) / 2 }
    strokesRef.current = transformStrokes(strokesRef.current, ids, 0, 0, scale, center)
    pushAction({ type: 'move', before, after: strokesRef.current.filter(s => ids.has(s.id)) }); afterChange()
  }
  const copySelection = () => {
    const copies = transformStrokes(selectionStrokes, new Set(selected), 15, 15).map(s => ({ ...s, id: uid() }))
    strokesRef.current = [...strokesRef.current, ...copies]; setSelected(copies.map(s => s.id)); pushAction({ type: 'add', strokes: copies }); afterChange()
  }
  const deleteSelection = useCallback(() => {
    if (!selected.length) return
    const ids = new Set(selected), removed = strokesRef.current.filter(s => ids.has(s.id))
    strokesRef.current = strokesRef.current.filter(s => !ids.has(s.id)); setSelected([]); pushAction({ type: 'erase', strokes: removed }); afterChange()
  }, [selected, afterChange])

  // 桌面快捷键：撤销/重做、P/E/L/H 切工具、Delete/Backspace 删选区、Ctrl+D 复制选区、Space 临时抓手平移
  const spacePrevToolRef = useRef<Tool | null>(null)
  useEffect(() => {
    const isInputFocused = (t: HTMLElement | null) =>
      Boolean(t && (t.closest('input, textarea, select, [contenteditable="true"], math-field')))
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (isInputFocused(t) || e.isComposing) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) undo()
        else if ((k === 'z' && e.shiftKey) || k === 'y') redo()
        else if (k === 'd' && selected.length) {
          const sel = strokesRef.current.filter((s) => selected.includes(s.id))
          if (!sel.length) return
          const copies = transformStrokes(sel, new Set(selected), 15, 15).map((s) => ({ ...s, id: uid() }))
          strokesRef.current = [...strokesRef.current, ...copies]
          setSelected(copies.map((s) => s.id))
          pushAction({ type: 'add', strokes: copies })
          afterChange()
        } else return
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.altKey) return
      if (e.code === 'Space' && !e.repeat) {
        if (toolRef.current !== 'hand') {
          spacePrevToolRef.current = toolRef.current
          setTool('hand')
        }
        e.preventDefault()
        return
      }
      if (k === 'p' || k === 'b') { setTool('pen'); setSelected([]) }
      else if (k === 'e') { setTool('eraser'); setSelected([]) }
      else if (k === 'l' || k === 's') { setTool('lasso'); setSelected([]) }
      else if (k === 'h') { setTool('hand'); setSelected([]) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'Escape' && selected.length) {
        setSelected([])
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spacePrevToolRef.current) {
        setTool(spacePrevToolRef.current)
        spacePrevToolRef.current = null
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [undo, redo, selected, afterChange, deleteSelection])

  /* ---------- 答案浮层 ---------- */

  const overlay: OverlayItem[] = useMemo(() => {
    void version
    const strokes = strokesRef.current
    if (!strokes.length) return []
    const h = estimateCharHeight(strokes)
    const blocks = clusterStrokes(strokes, { charHeight: h })
    const queue = queueRef.current
    const worldViewW = viewW > 0 ? viewW / zoom : 0
    const items: OverlayItem[] = []
    const widths: number[] = []
    for (const block of blocks) {
      const res = resultsRef.current.get(block.key) ?? null
      const failed = res ? undefined : queue?.failureOf(block.key)
      const pending = !res && !failed
      const blockStrokes = strokes.filter((s) => block.strokeIds.includes(s.id))
      const blockHeight = estimateCharHeight(blockStrokes, h)
      const column = columnRows(blockStrokes, blockHeight)
      const eq = column ? null : detectTrailingEquals(blockStrokes, blockHeight)
      const r = res?.result
      const isAssigned = r?.kind === 'none' && Boolean(r.assigned)
      const canCorrect = r?.kind === 'none' && !isAssigned && Boolean(eq || column)
      const isMark = !r || r.kind === 'error' || canCorrect || isAssigned
      const inline = r?.kind === 'inline' || (isMark && eq)
      // 标记（? / ⚠ / 手动输入 / ✓=val）没有尾部等号时放在块右侧中线；放不下同样换到下方
      const anchorEq = inline
        ? eq
        : isMark
          ? { box: { ...block.box, maxX: block.box.maxX + 10 - h * 0.3 }, midY: (block.box.minY + block.box.maxY) / 2 }
          : null
      const fontSize = Math.round(Math.min(96, Math.max(18, blockHeight * 0.95)))
      const measured = answerWidths.get(block.key)
      const width = !r
        ? failed
          ? FAIL_MARK_WIDTH
          : 92
        : r.kind === 'error'
          ? MARK_WIDTH
          : isAssigned
            ? Math.max(68, (r.assigned!.value.length + 4) * 9)
            : (measured ?? estimateAnswerWidth(plainOf(r.text || r.latex), anchorEq ? fontSize : Math.round(fontSize * 0.75), r.alt))
      const a = fitAnswer(block, anchorEq, blockHeight, { answerWidth: width, viewWidth: worldViewW, alignRight: Boolean(column) && !isMark })
      const blockPenWidth = blockStrokes.reduce((sum, stroke) => sum + stroke.width, 0) / Math.max(1, blockStrokes.length)
      const fontWeight = Math.max(400, Math.min(600, Math.round((blockPenWidth / blockHeight) * 3000 / 100) * 100 + 300))
      widths.push(width)
      items.push({
        key: block.key,
        block,
        res,
        failed,
        pending,
        x: a.x,
        y: a.y,
        fontSize: a.fontSize,
        fontWeight,
        canCorrect,
        placement: a.placement,
        maxWidth: a.maxWidth,
      })
    }

    const laidOut = layoutOverlayItems(
      items.map((it, idx) => ({
        key: it.key,
        block: it.block,
        x: it.x,
        y: it.y,
        fontSize: it.fontSize,
        placement: it.placement,
        answerWidth: widths[idx],
        hasChip: showLatex && Boolean(it.res),
        chipWidth: it.res ? Math.min(280, Math.max(64, plainOf(normalizeLatex(it.res.edited ?? it.res.recognized)).length * 8 + 20)) : 0,
      })),
      worldViewW,
    )
    return items.map((it) => {
      const pos = laidOut.get(it.key)
      return pos ? { ...it, x: pos.x, y: pos.y, chipPos: pos.chipPos } : it
    })
  }, [version, viewW, zoom, showLatex, answerWidths, queueRef])

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
    const failed = queueRef.current?.failureOf(key)
    setCreatingManual(false)
    setManualFallback({
      key,
      recognized: '',
      result: {
        kind: 'error',
        latex: '',
        text: '',
        message: failed ? '未能识别，请直接输入算式' : '可直接输入算式并点「重新计算」，无需等待模型加载',
      },
    })
    setEditing(key)
  }

  const openNewManualFormula = () => {
    setCreatingManual(true)
    setManualFallback({
      key: '__new_manual__',
      recognized: '',
      result: {
        kind: 'none',
        latex: '',
        text: '',
      },
    })
    setEditing('__new_manual__')
  }

  const submitEdit = async (latex: string) => {
    const key = editing
    const engine = engineRef.current
    if (!key || !engine) return
    if (creatingManual && key === '__new_manual__') {
      const editingPage = pageRef.current?.id
      setEditBusy(true)
      try {
        const blocks = clusterStrokes(strokesRef.current)
        const maxBottom = blocks.reduce((m, b) => Math.max(m, b.box.maxY), scrollYRef.current + 36)
        const ox = Math.max(24, scrollXRef.current + 28)
        const oy = blocks.length ? maxBottom + 36 : scrollYRef.current + 64
        const color = penColorRef.current === 'auto' ? undefined : penColorRef.current
        const newStrokes = synthFormulaStrokes(latex, ox, oy, 36, penWidthRef.current, color)
        const newIds = new Set(newStrokes.map((s) => s.id))
        const allStrokes = [...strokesRef.current, ...newStrokes]
        const nextBlocks = clusterStrokes(allStrokes)
        const newBlock = nextBlocks.find((b) => b.strokeIds.some((id) => newIds.has(id)))
        if (!newBlock) return
        const input = manualExpression(latex, false)
        const entries = nextBlocks.flatMap((b) => {
          if (b.key === newBlock.key) return [{ key: newBlock.key, latex: input }]
          const row = resultsRef.current.get(b.key)
          if (!row || (row.edited == null && row.result.message?.includes('方程组未识别完整'))) return []
          return [{ key: b.key, latex: row.edited ?? row.recognized }]
        })
        const evaluation = await evaluateEntriesNow(entries)
        if (!evaluation || pageRef.current?.id !== editingPage) return
        const result = evaluation.results[newBlock.key] ?? (await engine.compute(newBlock.key, input, { angleMode, variables: evaluation.variables }))
        strokesRef.current = allStrokes
        pushAction({ type: 'add', strokes: newStrokes })
        resultsRef.current.set(newBlock.key, { key: newBlock.key, recognized: input, edited: input, result })
        for (const entry of entries) {
          if (entry.key === newBlock.key) continue
          const old = resultsRef.current.get(entry.key)
          const next = evaluation.results[entry.key]
          if (old && next) resultsRef.current.set(entry.key, { ...old, result: next })
        }
        setCreatingManual(false)
        setManualFallback(null)
        setEditing(null)
        bump()
        markEdited('user')
      } catch (e) {
        toast(e instanceof Error ? e.message : '计算失败')
      } finally {
        setEditBusy(false)
      }
      return
    }
    const original = resultsRef.current.get(key)
    const current = original ?? (manualFallback?.key === key ? manualFallback : undefined)
    if (!current) return
    const editingPage = pageRef.current?.id
    setEditBusy(true)
    try {
      // 画布上写了尾部等号、但编辑时把「=」删了：补回去，答案仍写在等号后
      const blocks = clusterStrokes(strokesRef.current)
      const block = blocks.find((b) => b.key === key)
      const h = estimateCharHeight(strokesRef.current)
      const eq = block ? detectTrailingEquals(strokesRef.current.filter((s) => block.strokeIds.includes(s.id)), h) : null
      const column = block ? columnRows(strokesRef.current.filter((s) => block.strokeIds.includes(s.id)), h) : null
      const input = manualExpression(latex, Boolean(eq || column))
      const entries = blocks.flatMap((b) => {
        if (b.key === key) return [{ key, latex: input }]
        const row = resultsRef.current.get(b.key)
        if (!row || (row.edited == null && row.result.message?.includes('方程组未识别完整'))) return []
        return [{ key: b.key, latex: row.edited ?? row.recognized }]
      })
      const evaluation = await evaluateEntriesNow(entries)
      if (!evaluation || pageRef.current?.id !== editingPage || !clusterStrokes(strokesRef.current).some(b => b.key === key) || resultsRef.current.get(key) !== original) return
      const result = evaluation.results[key] ?? (await engine.compute(key, input, { angleMode, variables: evaluation.variables }))
      getQueue().retry(key)
      resultsRef.current.set(key, { ...current, edited: input, result })
      for (const entry of entries) {
        if (entry.key === key) continue
        const old = resultsRef.current.get(entry.key)
        const next = evaluation.results[entry.key]
        if (old && next) resultsRef.current.set(entry.key, { ...old, result: next })
      }
      setRevealed(previous => { const next = new Set(previous); next.delete(key); return next })
      graphsRef.current = graphsRef.current.map(graph => graph.sourceKey === key ? { ...graph, expression: input } : graph)
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
      const blocks = clusterStrokes(strokesRef.current)
      const entries = blocks.flatMap((b) => {
        if (b.key === key) return [{ key, latex: current.recognized }]
        const row = resultsRef.current.get(b.key)
        if (!row || (row.edited == null && row.result.message?.includes('方程组未识别完整'))) return []
        return [{ key: b.key, latex: row.edited ?? row.recognized }]
      })
      const evaluation = await evaluateEntriesNow(entries)
      if (!evaluation || pageRef.current?.id !== editingPage || !clusterStrokes(strokesRef.current).some(b => b.key === key) || resultsRef.current.get(key) !== current) return
      const result = evaluation.results[key] ?? (await engine.compute(key, current.recognized, { angleMode, variables: evaluation.variables }))
      resultsRef.current.set(key, { key, recognized: current.recognized, result })
      for (const entry of entries) {
        if (entry.key === key) continue
        const old = resultsRef.current.get(entry.key)
        const next = evaluation.results[entry.key]
        if (old && next) resultsRef.current.set(entry.key, { ...old, result: next })
      }
      graphsRef.current = graphsRef.current.map(graph => graph.sourceKey === key ? { ...graph, expression: current.recognized } : graph)
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

  const renameCurrentPage = async (nextTitle: string) => {
    const page = pageRef.current
    if (!page || page.title === nextTitle) return
    const updatedAt = Date.now()
    const updated = { ...page, title: nextTitle, updatedAt }
    pageRef.current = updated
    if (sessionRef.current?.id === page.id) {
      sessionRef.current.syncRename(nextTitle, updatedAt)
    }
    await db.mathNotes.update(page.id, { title: nextTitle, updatedAt })
    bump()
    toast(`已重命名为「${nextTitle}」`)
  }

  const copyAllFormulas = async () => {
    const blocks = clusterStrokes(strokesRef.current)
    const lines: string[] = []
    for (const block of blocks) {
      const res = resultsRef.current.get(block.key)
      if (!res) continue
      const expr = normalizeLatex(res.edited ?? res.recognized)
      const r = res.result
      if (r.assigned) lines.push(`${r.assigned.name} = ${r.assigned.value}`)
      else if (r.kind === 'error') lines.push(`${expr}  [错误: ${r.message ?? ''}]`)
      else if (r.kind === 'none') lines.push(expr)
      else {
        const val = r.text || r.latex
        const suffix = r.alt ? ` (≈ ${r.alt})` : ''
        if (/=\s*$/.test(expr)) lines.push(`${expr} ${val}${suffix}`)
        else lines.push(`${expr}  →  ${val}${suffix}`)
      }
    }
    if (!lines.length) {
      toast('本页还没有可复制的计算结果')
      return
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast(`已复制 ${lines.length} 条算式与结果`)
    } catch {
      toast('剪贴板写入失败')
    }
  }

  const exportPagePng = async () => {
    if (!strokesRef.current.length && !graphsRef.current.length) {
      toast('当前页面为空，暂无内容可导出')
      return
    }
    let box = strokesRef.current.reduce((acc, s) => unionBox(acc, strokeBox(s)), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    for (const g of graphsRef.current) {
      box = unionBox(box, { minX: g.x, minY: g.y, maxX: g.x + g.width, maxY: g.y + g.height })
    }
    if (!Number.isFinite(box.minX)) return
    const pad = 48
    const extraRight = 220
    const extraBottom = 90
    const w = Math.max(480, Math.ceil(box.maxX - box.minX + pad * 2 + extraRight))
    const h = Math.max(360, Math.ceil(box.maxY - box.minY + pad * 2 + extraBottom))
    const scale = Math.min(3, Math.max(2, Math.floor(2800 / Math.max(w, h))))
    const out = document.createElement('canvas')
    out.width = w * scale
    out.height = h * scale
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.scale(scale, scale)
    const bg = cssVar('--canvas', '#ffffff')
    const surface = cssVar('--surface', '#ffffff')
    const outline = cssVar('--outline', '#cbd5e1')
    const onSurface = cssVar('--on-surface', '#1d1d1f')
    const onSurface2 = cssVar('--on-surface-2', '#64748b')
    const primary = cssVar('--primary', '#2563eb')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    // 绘制轻量网格背景
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)'
    ctx.lineWidth = 1
    for (let gx = 0; gx <= w; gx += GRID) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke()
    }
    for (let gy = 0; gy <= h; gy += GRID) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke()
    }
    ctx.save()
    ctx.translate(pad - box.minX, pad - box.minY)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokesRef.current) {
      const color = resolveStrokeColor(s.color)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      drawStroke(ctx, s)
    }
    // 将画布中已渲染的嵌入式函数图像一同绘制进导出 PNG
    for (const g of graphsRef.current) {
      ctx.save()
      ctx.fillStyle = surface
      ctx.strokeStyle = outline
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(g.x, g.y, g.width, g.height, 12)
      ctx.fill()
      ctx.stroke()
      const headerH = 32
      ctx.fillStyle = onSurface
      ctx.font = '500 12px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(g.expression.slice(0, 32), g.x + 10, g.y + headerH / 2, g.width - 20)
      ctx.strokeStyle = outline
      ctx.beginPath()
      ctx.moveTo(g.x, g.y + headerH)
      ctx.lineTo(g.x + g.width, g.y + headerH)
      ctx.stroke()
      const svgNode = overlayRef.current?.querySelector<SVGSVGElement>(`[data-graph-id="${g.id}"] svg`)
      if (svgNode) {
        try {
          const rawSvg = new XMLSerializer()
            .serializeToString(svgNode)
            .replaceAll('var(--primary)', primary)
            .replaceAll('var(--outline)', outline)
            .replaceAll('var(--surface)', surface)
            .replaceAll('var(--on-surface-2)', onSurface2)
            .replaceAll('var(--on-surface)', onSurface)
          const img = new Image()
          const svgBlob = new Blob([rawSvg], { type: 'image/svg+xml;charset=utf-8' })
          const svgUrl = URL.createObjectURL(svgBlob)
          await new Promise<void>((resolve) => {
            img.onload = () => {
              ctx.drawImage(img, g.x + 2, g.y + headerH + 2, g.width - 4, g.height - headerH - 4)
              URL.revokeObjectURL(svgUrl)
              resolve()
            }
            img.onerror = () => {
              URL.revokeObjectURL(svgUrl)
              resolve()
            }
            img.src = svgUrl
          })
        } catch { /* 图像序列化失败时保留外框 */ }
      }
      ctx.restore()
    }
    // 绘制计算结果文字（带浅背景描边，在网格上依然清晰）
    const isDark = document.documentElement.classList.contains('dark')
    const ansColor = isDark ? '#FBBF24' : '#B45309'
    ctx.textBaseline = 'middle'
    for (const it of overlay) {
      const r = it.res?.result
      if (!r || r.kind === 'error' || (r.kind === 'none' && !r.assigned)) continue
      const label = r.assigned ? `✓ = ${r.assigned.value}` : (r.text || plainOf(r.latex)) + (r.alt ? ` ≈ ${r.alt}` : '')
      if (!label) continue
      ctx.font = `${it.fontWeight ?? 500} ${it.fontSize}px ${HAND_FONT}`
      const drawY = it.y
      ctx.strokeStyle = bg
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.strokeText(label, it.x, drawY)
      ctx.fillStyle = ansColor
      ctx.fillText(label, it.x, drawY)
    }
    ctx.restore()
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
    if (!blob) {
      toast('导出图片失败')
      return
    }
    const safeTitle = (pageRef.current?.title || '手写计算').replace(/[\\/:*?"<>|]/g, '_')
    const saved = await saveBlob(blob, `${safeTitle}.png`)
    toast(`已导出到${saved}`, openSavedAction())
  }

  /* ---------- 视图 ---------- */

  const percent = model.phase === 'loading' && model.ratio >= 0 ? Math.round(model.ratio * 100) : null
  const editingGraph = graphsRef.current.find((graph) => graph.id === plotGraphId)
  const varList = Object.entries(pageVariables)

  const previewCompute = useCallback(
    (latex: string) => {
      const engine = engineRef.current
      if (!engine) return Promise.reject(new Error('计算器未就绪'))
      return engine.compute('__preview__', latex, { angleMode, variables: pageVariables })
    },
    [angleMode, engineRef, pageVariables],
  )

  return (
    // AppShell 对本路由开沉浸模式（隐藏全局顶栏 / 底栏，内容区 h-full 不滚动），这里铺满即可。
    // 不用 position: fixed —— 外层路由动画留着 transform，fixed 会相对它而不是视口定位。
    <div
      className="h-full flex flex-col bg-canvas text-on-surface"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <MathNotesToolbar
        pages={pages}
        pageIndex={pageIndex}
        pageCount={pages.length}
        canUndo={undoRef.current.length > 0}
        canRedo={redoRef.current.length > 0}
        tool={tool}
        penColor={penColor}
        penWidth={penWidth}
        zoom={zoom}
        angleMode={angleMode}
        penLocked={penLocked}
        showLatex={showLatex}
        onBack={() => navigate('/tools')}
        onGoPage={goPage}
        onSelectPage={openPage}
        onUndo={undo}
        onRedo={redo}
        onSelectTool={(t) => {
          setTool(t)
          setSelected([])
        }}
        onSelectPenColor={setPenColor}
        onSelectPenWidth={setPenWidth}
        onZoomChange={(nextZoom) => zoomAt(nextZoom)}
        onToggleAngleMode={() => {
          const next: AngleMode = angleMode === 'rad' ? 'deg' : 'rad'
          setAngleMode(next)
          void db.settings.put({ key: 'mathNotesAngleMode', value: next })
        }}
        onUnlockFinger={unlockFinger}
        onToggleLatex={() => setShowLatex((v) => !v)}
        onAddPage={() => void addPage()}
        onRenamePage={() => setRenameOpen(true)}
        onClearAll={clearAll}
        onNewFormula={openNewManualFormula}
        onCopyAll={() => void copyAllFormulas()}
        onExportPng={() => void exportPagePng()}
        onOpenPlot={() => {
          setPlotSource(undefined)
          setPlotGraphId(undefined)
          setPlotInput('y=x^2')
          setPlotOpen(true)
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDelete={() => setDeleteOpen(true)}
      />

      {/* 画布 */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in srgb, var(--outline) 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--outline) 55%, transparent) 1px, transparent 1px)',
          backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`,
        }}
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 touch-none ${tool === 'eraser' ? 'cursor-cell' : tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* 答案层：世界坐标，随滚动与缩放整体变换；只有答案本身可点 */}
        <div ref={overlayRef} className="absolute inset-0 pointer-events-none" style={{ transformOrigin: '0 0' }} aria-live="polite">
          {overlay.map((it) => (
            <OverlayAnswer
              key={it.key}
              item={it}
              showLatex={showLatex}
              mode={resultMode}
              revealed={revealed.has(it.key)}
              onReveal={() => setRevealed((previous) => new Set(previous).add(it.key))}
              onOpen={() => setEditing(it.key)}
              onRetry={() => retryBlock(it.key)}
              onManual={() => openManual(it.key)}
              onMeasure={onMeasure}
            />
          ))}
          <EmbeddedGraphLayer
            graphs={graphsRef.current}
            graphsRef={graphsRef}
            resultsRef={resultsRef}
            graphDrag={graphDrag}
            zoom={zoom}
            pushAction={pushAction}
            bump={bump}
            markEdited={markEdited}
            plot={plotFunction}
            onOpenPlot={(graph, expression) => {
              setPlotInput(expression)
              setPlotSource(graph.sourceKey)
              setPlotGraphId(graph.id)
              setPlotOpen(true)
            }}
          />
          {selectionBox && tool === 'lasso' && (
            <LassoSelectionOverlay
              selectionBox={selectionBox}
              strokesRef={strokesRef}
              selectionDrag={selectionDrag}
              selected={selected}
              zoom={zoom}
              pushAction={pushAction}
              afterChange={afterChange}
              bump={bump}
              onScale={changeSelection}
              onCopy={copySelection}
              onDelete={deleteSelection}
            />
          )}
        </div>

        {penLocked && (
          <button
            type="button"
            onClick={unlockFinger}
            aria-label="允许手指书写"
            className="md:hidden absolute top-2.5 left-1/2 -translate-x-1/2 z-20 inline-flex items-center h-8 px-3 rounded-full border border-primary/40 bg-surface text-primary text-xs font-medium shadow-sm whitespace-nowrap cursor-pointer"
          >
            允许手指书写
          </button>
        )}

        {varList.length > 0 && (
          <div
            aria-label="当前页已定义变量"
            className="absolute top-2.5 left-2.5 z-10 flex flex-wrap items-center gap-1 max-w-[calc(100%-1.25rem)] pointer-events-none"
          >
            {varList.map(([name, val]) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full border border-ok/35 bg-surface px-2 py-0.5 text-[11px] font-medium text-ok shadow-xs tabular-nums"
              >
                {name} = {Number(val.toPrecision(6))}
              </span>
            ))}
          </div>
        )}

        {!strokesRef.current.length && pageId && (
          <div className="absolute inset-x-0 top-[28%] text-center pointer-events-none px-6 flex flex-col items-center">
            <p className="text-[15px] font-medium text-on-surface-2" style={{ fontFamily: HAND_FONT }}>
              在任意位置写下算式，写完「=」就有答案
            </p>
            <p className="text-[12px] text-on-surface-2/80 mt-2 leading-relaxed">
              方程、方程组、不等式不写等号也可自动计算 · 用笔来回涂抹即可快速擦除 · 双指可平移缩放 · 点答案可纠错或绘图
            </p>
          </div>
        )}

        <ModelStatusBanner
          model={model}
          percent={percent}
          recognizing={recognizing}
          onOpenSettings={() => setSettingsOpen(true)}
          onDownloadModel={() => void loadModel()}
          onRetryModel={() => void loadModel({ fresh: true })}
          onNewFormula={openNewManualFormula}
        />
      </div>

      <MathNotesDialogs
        editingBlock={editingBlock}
        editBusy={editBusy}
        pageVariables={pageVariables}
        previewCompute={previewCompute}
        onCloseEdit={() => {
          setCreatingManual(false)
          setEditing(null)
        }}
        onSubmitEdit={(latex) => void submitEdit(latex)}
        onResetEdit={() => void resetEdit()}
        onPlotFromEdit={(latex) => {
          setPlotSource(editing === '__new_manual__' ? undefined : (editing ?? undefined))
          setPlotGraphId(undefined)
          setCreatingManual(false)
          setEditing(null)
          setPlotInput(latex)
          setPlotOpen(true)
        }}
        plotOpen={plotOpen}
        plotInput={plotInput}
        editingGraph={editingGraph}
        onPlotOpenChange={setPlotOpen}
        plotFunction={plotFunction}
        onInsertGraph={(expression, range, tMin, tMax, centerX, centerY, hiddenCurves) => {
          const source = plotSource ? resultsRef.current.get(plotSource) : undefined
          const sourceKey = source && (source.edited ?? source.recognized) === expression ? plotSource : undefined
          const before = graphsRef.current
          const existing = graphsRef.current.find((graph) => graph.id === plotGraphId)
          if (existing) {
            graphsRef.current = graphsRef.current.map((graph) =>
              graph.id === existing.id ? { ...graph, expression, sourceKey, range, tMin, tMax, centerX, centerY, hiddenCurves } : graph,
            )
          } else {
            const width = Math.min(320, Math.max(200, viewW - 32))
            const height = 250
            const pos = findGraphPlacement(clusterStrokes(strokesRef.current), graphsRef.current, {
              width,
              height,
              viewWidth: viewW > 0 ? viewW / zoom : 0,
              scrollY: scrollYRef.current,
              sourceKey,
            })
            graphsRef.current = [
              ...graphsRef.current,
              {
                id: uid(),
                expression,
                sourceKey,
                x: pos.x,
                y: pos.y,
                width,
                height,
                range,
                tMin,
                tMax,
                centerX,
                centerY,
                hiddenCurves,
              },
            ]
          }
          pushAction({ type: 'graphs', before, after: graphsRef.current })
          setPlotOpen(false)
          bump()
          markEdited('user')
        }}
        renameOpen={renameOpen}
        pageTitle={pageRef.current?.title ?? ''}
        onRenameOpenChange={setRenameOpen}
        onRenamePage={(title) => void renameCurrentPage(title)}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={setDeleteOpen}
        onConfirmDelete={() => void removePage()}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        source={source}
        onSourceChange={setSourceState}
        onApplySource={(cfg) => void applySource(cfg)}
        resultMode={resultMode}
        onResultModeChange={(value) => {
          setResultMode(value)
          setRevealed(new Set())
          void db.settings.put({ key: 'mathNotesResultMode', value })
        }}
        angleMode={angleMode}
        onAngleModeChange={(value) => {
          setAngleMode(value)
          void db.settings.put({ key: 'mathNotesAngleMode', value })
        }}
        model={model}
        percent={percent}
        onReloadModel={() => void loadModel({ fresh: true })}
      />
    </div>
  )
}
