import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { clusterStrokes, columnRows, detectTrailingEquals, estimateAnswerWidth, estimateCharHeight, fitAnswer, strokeBox, unionBox } from './geometry'
import { transformStrokes } from './lasso'
import { manualExpression } from './mathText'
import { createPage, deletePage, getLastPageId, listPages, newPage, setLastPageId } from './store'
import { NoteSession, type EditKind } from './noteSession'
import { FAIL_MARK_WIDTH, GRID, HAND_FONT, MARK_WIDTH, plainOf, type Action, type OverlayItem, type Tool } from './canvasDraw'
import { EmbeddedGraphLayer, LassoSelectionOverlay, ModelStatusBanner, OverlayAnswer } from './MathNotesOverlay'
import { MathNotesToolbar } from './MathNotesToolbar'
import { MathNotesDialogs } from './MathNotesDialogs'
import { useCanvasPointer } from './useCanvasPointer'
import { useMathRecognition } from './useMathRecognition'
import type { BlockResult, MathNotePage, NoteGraph, Stroke } from './types'
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
  const [showLatex, setShowLatex] = useState(false)
  const [resultMode, setResultMode] = useState<'auto' | 'suggest' | 'off'>('auto')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  useEffect(() => { void db.settings.get('mathNotesResultMode').then(row => { if (row?.value === 'auto' || row?.value === 'suggest' || row?.value === 'off') setResultMode(row.value) }) }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [plotOpen, setPlotOpen] = useState(false)
  const [plotInput, setPlotInput] = useState('y=x^2')
  const [plotSource, setPlotSource] = useState<string | undefined>()
  const [plotGraphId, setPlotGraphId] = useState<string | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [manualFallback, setManualFallback] = useState<BlockResult | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [viewW, setViewW] = useState(0)
  /** 答案元素实测宽度（key → CSS 像素），用于判断等号右侧放不放得下 */
  const [answerWidths, setAnswerWidths] = useState<Map<string, number>>(() => new Map())

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
      if (!opts.keepScroll) scrollYRef.current = 0
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

  // 离开页面：有改动才保存，没编辑过不写库
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
      void sessionRef.current?.close().catch(() => undefined)
    },
    [],
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

  const { onPointerDown, onPointerMove, onPointerEnd, onWheel } = useCanvasPointer({
    containerRef,
    canvasRef,
    overlayRef,
    strokesRef,
    graphsRef,
    lassoRef,
    scrollYRef,
    sizeRef,
    idleTimer,
    toolRef,
    setSelected,
    setViewW,
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
  const deleteSelection = () => {
    const ids = new Set(selected), removed = strokesRef.current.filter(s => ids.has(s.id))
    strokesRef.current = strokesRef.current.filter(s => !ids.has(s.id)); setSelected([]); pushAction({ type: 'erase', strokes: removed }); afterChange()
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
  }, [version, viewW, answerWidths, queueRef])

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
      setRevealed(previous => { const next = new Set(previous); next.delete(key); return next })
      graphsRef.current = graphsRef.current.map(graph => graph.sourceKey === key ? { ...graph, expression: latex } : graph)
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

  /* ---------- 视图 ---------- */

  const percent = model.phase === 'loading' && model.ratio >= 0 ? Math.round(model.ratio * 100) : null
  const editingGraph = graphsRef.current.find((graph) => graph.id === plotGraphId)

  return (
    // AppShell 对本路由开沉浸模式（隐藏全局顶栏 / 底栏，内容区 h-full 不滚动），这里铺满即可。
    // 不用 position: fixed —— 外层路由动画留着 transform，fixed 会相对它而不是视口定位。
    <div
      className="h-full flex flex-col bg-canvas text-on-surface"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <MathNotesToolbar
        pageIndex={pageIndex}
        pageCount={pages.length}
        canUndo={undoRef.current.length > 0}
        canRedo={redoRef.current.length > 0}
        tool={tool}
        showLatex={showLatex}
        onBack={() => navigate('/tools')}
        onGoPage={goPage}
        onUndo={undo}
        onRedo={redo}
        onSelectTool={(t) => {
          setTool(t)
          setSelected([])
        }}
        onToggleLatex={() => setShowLatex((v) => !v)}
        onAddPage={() => void addPage()}
        onClearAll={clearAll}
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
          backgroundSize: `${GRID}px ${GRID}px`,
        }}
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 touch-none ${tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
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
              pushAction={pushAction}
              afterChange={afterChange}
              bump={bump}
              onScale={changeSelection}
              onCopy={copySelection}
              onDelete={deleteSelection}
            />
          )}
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

        <ModelStatusBanner
          model={model}
          percent={percent}
          recognizing={recognizing}
          onOpenSettings={() => setSettingsOpen(true)}
          onRetryModel={() => void loadModel({ fresh: true })}
        />
      </div>

      <MathNotesDialogs
        editingBlock={editingBlock}
        editBusy={editBusy}
        onCloseEdit={() => setEditing(null)}
        onSubmitEdit={(latex) => void submitEdit(latex)}
        onResetEdit={() => void resetEdit()}
        onPlotFromEdit={(latex) => {
          setPlotSource(editing ?? undefined)
          setPlotGraphId(undefined)
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
            graphsRef.current = [
              ...graphsRef.current,
              {
                id: uid(),
                expression,
                sourceKey,
                x: 16,
                y: scrollYRef.current + 36,
                width: Math.min(280, Math.max(180, viewW - 32)),
                height: 220,
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
        model={model}
        percent={percent}
        onReloadModel={() => void loadModel({ fresh: true })}
      />
    </div>
  )
}
