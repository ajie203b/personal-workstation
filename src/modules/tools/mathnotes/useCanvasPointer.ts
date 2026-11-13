import { useCallback, useEffect, useRef } from 'react'
import { uid } from '@/lib/id'
import { smoothAppend, strokeBox, strokesHitBy } from './geometry'
import { selectInLasso } from './lasso'
import { PointerGesture } from './pointerGesture'
import { cssVar, drawStroke, ERASER_RADIUS, PEN_WIDTH, type Action, type Tool } from './canvasDraw'
import type { InkPoint, NoteGraph, Stroke } from './types'

export function useCanvasPointer({
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
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  overlayRef: React.RefObject<HTMLDivElement | null>
  strokesRef: React.MutableRefObject<Stroke[]>
  graphsRef: React.MutableRefObject<NoteGraph[]>
  lassoRef: React.MutableRefObject<{ pointerId: number; points: { x: number; y: number }[] } | null>
  scrollYRef: React.MutableRefObject<number>
  sizeRef: React.MutableRefObject<{ w: number; h: number; dpr: number }>
  idleTimer: React.MutableRefObject<number | undefined>
  toolRef: React.MutableRefObject<Tool>
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  setViewW: React.Dispatch<React.SetStateAction<number>>
  version: number
  pushAction: (a: Action) => void
  afterChange: (lastStroke?: Stroke) => void
}) {
  const drawingRef = useRef<{ pointerId: number; stroke: Stroke } | null>(null)
  const erasedRef = useRef<Stroke[]>([])
  const gestureRef = useRef(new PointerGesture())
  const panRef = useRef<{ y: number; scroll: number } | null>(null)

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
    const lasso = lassoRef.current
    if (lasso && lasso.points.length > 1) {
      ctx.save()
      ctx.strokeStyle = cssVar('--primary', '#2c55b8')
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      lasso.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
      ctx.restore()
    }
    if (containerRef.current) containerRef.current.style.backgroundPositionY = `${-scrollYRef.current}px`
    if (overlayRef.current) overlayRef.current.style.transform = `translateY(${-scrollYRef.current}px)`
  }, [canvasRef, containerRef, lassoRef, overlayRef, scrollYRef, sizeRef, strokesRef])

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
  }, [canvasRef, containerRef, redraw, setViewW, sizeRef])

  useEffect(() => {
    redraw()
  }, [version, redraw])

  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top + scrollYRef.current }
  }

  const maxScroll = () => {
    let bottom = 0
    for (const s of strokesRef.current) bottom = Math.max(bottom, strokeBox(s).maxY)
    for (const graph of graphsRef.current) bottom = Math.max(bottom, graph.y + graph.height)
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
      if (lassoRef.current) {
        lassoRef.current = null
        redraw()
      }
      panRef.current = { y: r.centerY, scroll: scrollYRef.current }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    window.clearTimeout(idleTimer.current)
    const { x, y } = toWorld(e)
    if (toolRef.current === 'lasso') {
      setSelected([])
      lassoRef.current = { pointerId: e.pointerId, points: [{ x, y }] }
      return
    }
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
    if (lassoRef.current?.pointerId === e.pointerId && g.isDrawing(e.pointerId)) {
      lassoRef.current.points.push(toWorld(e))
      redraw()
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
    if (lassoRef.current?.pointerId === e.pointerId) {
      const polygon = lassoRef.current.points
      lassoRef.current = null
      if (!cancelled) setSelected(selectInLasso(strokesRef.current, polygon))
      redraw()
    }
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

  return { redraw, drawingRef, gestureRef, panRef, onPointerDown, onPointerMove, onPointerEnd, onWheel }
}
