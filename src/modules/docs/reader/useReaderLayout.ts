import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { DEFAULT_READER_PANELS, READER_PANEL_LIMITS, useUi } from '@/stores/ui'

/**
 * 分栏布局职责（从 DocReaderPage 抽出）：
 * 左右栏的宽度、拖拽、折叠、键盘调宽，以及「改栏宽导致正文重排时把阅读位置钉住」。
 *
 * 两个刻意的设计：
 * - 拖拽中只改 CSS 变量（--reader-left-w / --reader-right-w），不 setState —— 否则每个
 *   pointermove 都要重渲染整篇正文，长文档会卡。
 * - 重排会让行数变化、滚动位置漂移，所以拖动前先记下视口顶部那一块与块内比例，重排后放回。
 */
export function useReaderLayout(docId: string | undefined, scrollRef: React.RefObject<HTMLDivElement>) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  /** 拖动分隔线时的起点；宽度直接写 CSS 变量，避免每个 pointermove 都重渲染正文 */
  const splitDrag = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null)
  /** 改栏宽会让正文重排：记下视口顶部那一块及块内相对位置，重排后放回原处 */
  const readingAnchor = useRef<{ el: HTMLElement; ratio: number; gap: number } | null>(null)
  /** 连续改宽时只保留最后一轮锚点跟踪 */
  const anchorSeq = useRef(0)

  const readerPanels = useUi((s) => s.readerPanels)
  const setReaderPanels = useUi((s) => s.setReaderPanels)

  // 组件在拖拽途中被卸载时，别把全页的 col-resize / 禁选留下
  useEffect(() => () => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const panelWidth = (side: 'left' | 'right') =>
    side === 'left' ? readerPanels.leftWidth : readerPanels.rightWidth

  const applyPanelWidth = (side: 'left' | 'right', width: number) => {
    workspaceRef.current?.style.setProperty(
      side === 'left' ? '--reader-left-w' : '--reader-right-w',
      `${Math.round(width)}px`,
    )
  }

  const captureReadingAnchor = useCallback(() => {
    anchorSeq.current += 1
    const container = scrollRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    const nodes = container.querySelectorAll<HTMLElement>('.md-body > *, section[data-seg], [data-page]')
    let hit: HTMLElement | null = null
    for (const el of nodes) {
      const r = el.getBoundingClientRect()
      if (r.bottom > cr.top + 8 && r.top < cr.bottom) { hit = el; break }
    }
    if (!hit) { readingAnchor.current = null; return }
    const r = hit.getBoundingClientRect()
    const gap = Math.max(0, r.top - cr.top)
    // 块顶在视口上方时记录「读到了块内百分之几」，PDF 页这种高块重排后不会跳行
    const ratio = gap > 0 || r.height <= 0 ? 0 : Math.min(1, (cr.top - r.top) / r.height)
    readingAnchor.current = { el: hit, ratio, gap }
  }, [scrollRef])

  const restoreReadingAnchor = useCallback(() => {
    const a = readingAnchor.current
    const container = scrollRef.current
    if (!a || !container || !a.el.isConnected) return
    const cr = container.getBoundingClientRect()
    const r = a.el.getBoundingClientRect()
    const desiredTop = a.gap > 0 ? a.gap : -a.ratio * r.height
    const delta = (r.top - cr.top) - desiredTop
    if (Math.abs(delta) > 0.5) container.scrollTop += delta
  }, [scrollRef])

  /** 折叠有 300ms 宽度过渡，PDF 页宽还会晚一帧重排；多盯一小段保持锚点 */
  const keepReadingAnchor = useCallback((duration = 420) => {
    const seq = ++anchorSeq.current
    const start = performance.now()
    const tick = () => {
      if (seq !== anchorSeq.current) return
      restoreReadingAnchor()
      if (performance.now() - start < duration) requestAnimationFrame(tick)
      else readingAnchor.current = null
    }
    requestAnimationFrame(tick)
  }, [restoreReadingAnchor])

  // 首次布局在绘制前写好变量；之后拖动只改 DOM 变量，正文不参与重渲染
  // docId 必须参与：首次挂载时 doc 还没到，workspace 尚未渲染，ref 是空的
  useLayoutEffect(() => {
    applyPanelWidth('left', readerPanels.leftWidth)
    applyPanelWidth('right', readerPanels.rightWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerPanels.leftWidth, readerPanels.rightWidth, docId])

  const clampPanel = (side: 'left' | 'right', width: number) => {
    const limits = side === 'left' ? READER_PANEL_LIMITS.left : READER_PANEL_LIMITS.right
    const ws = workspaceRef.current
    // 窄窗口的另一栏可能已变为抽屉，按实际可见宽度计算正文空间。
    const otherSide = side === 'left' ? 'right' : 'left'
    const other = ws?.querySelector<HTMLElement>(`[data-reader-panel="${otherSide}"]`)?.getBoundingClientRect().width ?? 0
    const available = ws ? ws.clientWidth - other - 360 : limits.max
    return Math.round(Math.min(limits.max, Math.max(limits.min, Math.min(width, available))))
  }

  const onSplitDown = (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    captureReadingAnchor()
    splitDrag.current = { side, startX: e.clientX, startW: panelWidth(side) }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老浏览器无捕获也能拖 */ }
    workspaceRef.current?.setAttribute('data-resizing', 'true')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onSplitMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current
    if (!d) return
    const delta = e.clientX - d.startX
    const raw = d.side === 'left' ? d.startW + delta : d.startW - delta
    applyPanelWidth(d.side, clampPanel(d.side, raw))
    restoreReadingAnchor()
  }

  const onSplitEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current
    if (!d) return
    splitDrag.current = null
    workspaceRef.current?.removeAttribute('data-resizing')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 未捕获时忽略 */ }
    const varName = d.side === 'left' ? '--reader-left-w' : '--reader-right-w'
    const width = Number.parseFloat(workspaceRef.current?.style.getPropertyValue(varName) ?? '')
    if (Number.isFinite(width)) {
      setReaderPanels(d.side === 'left' ? { leftWidth: width } : { rightWidth: width })
    }
    // PDF 页宽由子组件异步量完后重排，多盯一段把锚点压住
    keepReadingAnchor(320)
  }

  const onSplitKey = (side: 'left' | 'right') => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.shiftKey ? 32 : 16
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const grow = side === 'left' ? dir : -dir
    const next = clampPanel(side, panelWidth(side) + grow * step)
    captureReadingAnchor()
    applyPanelWidth(side, next)
    setReaderPanels(side === 'left' ? { leftWidth: next } : { rightWidth: next })
    keepReadingAnchor(320)
  }

  const toggleReaderPanel = (side: 'left' | 'right') => {
    captureReadingAnchor()
    setReaderPanels(side === 'left'
      ? { leftCollapsed: !readerPanels.leftCollapsed }
      : { rightCollapsed: !readerPanels.rightCollapsed })
    keepReadingAnchor()
  }

  const resetReaderLayout = () => {
    captureReadingAnchor()
    setReaderPanels(DEFAULT_READER_PANELS)
    keepReadingAnchor()
  }

  const resetPanelWidth = (side: 'left' | 'right') => {
    const width = side === 'left' ? DEFAULT_READER_PANELS.leftWidth : DEFAULT_READER_PANELS.rightWidth
    captureReadingAnchor()
    applyPanelWidth(side, width)
    setReaderPanels(side === 'left' ? { leftWidth: width } : { rightWidth: width })
    keepReadingAnchor(320)
  }

  return {
    workspaceRef,
    readerPanels,
    toggleReaderPanel,
    resetReaderLayout,
    resetPanelWidth,
    onSplitDown,
    onSplitMove,
    onSplitEnd,
    onSplitKey,
  }
}
