import { useCallback, useEffect, useRef } from 'react'
import { uid } from '@/lib/id'
import { detectScratchOut, estimateCharHeight, smoothAppend, strokeBox, strokesHitBy } from './geometry'
import { selectInLasso } from './lasso'
import { PointerGesture } from './pointerGesture'
import { drawStroke, ERASER_RADIUS, GRID, MAX_ZOOM, MIN_ZOOM, resolveStrokeColor, type Action, type Tool } from './canvasDraw'
import type { InkPoint, NoteGraph, Stroke } from './types'

export function useCanvasPointer({
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
  onZoomChange,
  onPenLockChange,
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
  scrollXRef: React.MutableRefObject<number>
  scrollYRef: React.MutableRefObject<number>
  zoomRef: React.MutableRefObject<number>
  penColorRef: React.MutableRefObject<string>
  penWidthRef: React.MutableRefObject<number>
  sizeRef: React.MutableRefObject<{ w: number; h: number; dpr: number }>
  idleTimer: React.MutableRefObject<number | undefined>
  toolRef: React.MutableRefObject<Tool>
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  setViewW: React.Dispatch<React.SetStateAction<number>>
  onZoomChange: (zoom: number) => void
  onPenLockChange: (locked: boolean) => void
  version: number
  pushAction: (a: Action) => void
  afterChange: (lastStroke?: Stroke) => void
}) {
  const drawingRef = useRef<{ pointerId: number; stroke: Stroke; tempEraser?: boolean } | null>(null)
  const erasedRef = useRef<Stroke[]>([])
  const eraserPosRef = useRef<{ x: number; y: number } | null>(null)
  const gestureRef = useRef(new PointerGesture())
  const panRef = useRef<{ x: number; y: number; scrollX: number; scrollY: number; distance?: number | null; zoom?: number } | null>(null)
  const handPanRef = useRef<{ pointerId: number; x: number; y: number; scrollX: number; scrollY: number } | null>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h, dpr } = sizeRef.current
    const z = zoomRef.current
    const sx = scrollXRef.current
    const sy = scrollYRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -sx * dpr * z, -sy * dpr * z)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const left = sx - 20 / z
    const right = sx + (w + 20) / z
    const top = sy - 20 / z
    const bottom = sy + (h + 20) / z
    const colorCache = new Map<string, string>()
    const colorOf = (c?: string) => {
      const k = c || 'auto'
      let hit = colorCache.get(k)
      if (!hit) {
        hit = resolveStrokeColor(k)
        colorCache.set(k, hit)
      }
      return hit
    }
    for (const s of strokesRef.current) {
      const b = strokeBox(s)
      if (b.maxY < top || b.minY > bottom || b.maxX < left || b.minX > right) continue
      const color = colorOf(s.color)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      drawStroke(ctx, s)
    }
    const lasso = lassoRef.current
    if (lasso && lasso.points.length > 1) {
      ctx.save()
      ctx.strokeStyle = colorOf('auto')
      ctx.lineWidth = 1.5 / z
      ctx.setLineDash([5 / z, 4 / z])
      ctx.beginPath()
      lasso.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
      ctx.restore()
    }
    const eraserPos = eraserPosRef.current
    if (eraserPos && (toolRef.current === 'eraser' || drawingRef.current?.tempEraser)) {
      ctx.save()
      const r = ERASER_RADIUS / z
      ctx.beginPath()
      ctx.arc(eraserPos.x, eraserPos.y, r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(220, 38, 38, 0.1)'
      ctx.fill()
      ctx.lineWidth = 1.4 / z
      ctx.strokeStyle = 'rgba(220, 38, 38, 0.7)'
      ctx.stroke()
      ctx.restore()
    }
    if (containerRef.current) {
      containerRef.current.style.backgroundSize = `${GRID * z}px ${GRID * z}px`
      containerRef.current.style.backgroundPosition = `${-sx * z}px ${-sy * z}px`
    }
    if (overlayRef.current) {
      overlayRef.current.style.transformOrigin = '0 0'
      overlayRef.current.style.transform = `translate(${-sx * z}px, ${-sy * z}px) scale(${z})`
    }
  }, [canvasRef, containerRef, lassoRef, overlayRef, scrollXRef, scrollYRef, sizeRef, strokesRef, toolRef, zoomRef])

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
    const z = zoomRef.current
    return {
      x: (e.clientX - rect.left) / z + scrollXRef.current,
      y: (e.clientY - rect.top) / z + scrollYRef.current,
    }
  }

  const maxScroll = useCallback(() => {
    let right = 0
    let bottom = 0
    for (const s of strokesRef.current) {
      const b = strokeBox(s)
      if (b.maxX > right) right = b.maxX
      if (b.maxY > bottom) bottom = b.maxY
    }
    for (const graph of graphsRef.current) {
      if (graph.x + graph.width > right) right = graph.x + graph.width
      if (graph.y + graph.height > bottom) bottom = graph.y + graph.height
    }
    const z = zoomRef.current
    const vw = sizeRef.current.w / z
    const vh = sizeRef.current.h / z
    const maxX = Math.max(0, right + 240 - vw, z > 1 ? sizeRef.current.w * (1 - 1 / z) + 120 : 120)
    const maxY = Math.max(0, bottom + vh * 0.6)
    return { maxX, maxY }
  }, [graphsRef, sizeRef, strokesRef, zoomRef])

  const scrollTo = useCallback(
    (x: number, y: number) => {
      const { maxX, maxY } = maxScroll()
      scrollXRef.current = Math.max(0, Math.min(maxX, x))
      scrollYRef.current = Math.max(0, Math.min(maxY, y))
      redraw()
    },
    [maxScroll, redraw, scrollXRef, scrollYRef],
  )

  const zoomAt = useCallback(
    (targetZoom: number, anchorScreenX?: number, anchorScreenY?: number) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(targetZoom * 100) / 100))
      const prev = zoomRef.current
      if (Math.abs(next - prev) < 0.001) return
      const sx = anchorScreenX ?? sizeRef.current.w / 2
      const sy = anchorScreenY ?? sizeRef.current.h / 2
      const wx = sx / prev + scrollXRef.current
      const wy = sy / prev + scrollYRef.current
      zoomRef.current = next
      onZoomChange(next)
      scrollTo(wx - sx / next, wy - sy / next)
    },
    [onZoomChange, scrollTo, scrollXRef, scrollYRef, sizeRef, zoomRef],
  )

  const unlockFinger = useCallback(() => {
    gestureRef.current.penSeen = false
    onPenLockChange(false)
  }, [onPenLockChange])

  // 非 passive wheel 监听：Ctrl/Cmd+滚轮围绕鼠标位置缩放，普通滚轮支持横纵双轴平移
  useEffect(() => {
    const el = containerRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = Math.exp(-e.deltaY * 0.0025)
        const rect = canvas.getBoundingClientRect()
        zoomAt(zoomRef.current * factor, e.clientX - rect.left, e.clientY - rect.top)
        return
      }
      e.preventDefault()
      const z = zoomRef.current
      scrollTo(scrollXRef.current + e.deltaX / z, scrollYRef.current + e.deltaY / z)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [canvasRef, containerRef, scrollTo, scrollXRef, scrollYRef, zoomAt, zoomRef])

  const eraseAt = (x: number, y: number) => {
    eraserPosRef.current = { x, y }
    const hit = new Set(strokesHitBy(strokesRef.current, x, y, ERASER_RADIUS / zoomRef.current))
    if (hit.size) {
      erasedRef.current.push(...strokesRef.current.filter((s) => hit.has(s.id)))
      strokesRef.current = strokesRef.current.filter((s) => !hit.has(s.id))
    }
    redraw()
  }

  /**
   * 结束进行中的书写。commit：笔画入库（橡皮则提交擦除，涂抹手势则擦除命中笔画）；discard：丢弃笔画（橡皮擦掉的仍提交）。
   */
  const finishDrawing = (end: 'commit' | 'discard', last?: { x: number; y: number; t: number }) => {
    const d = drawingRef.current
    drawingRef.current = null
    eraserPosRef.current = null
    if (!d) return
    if (toolRef.current === 'eraser' || d.tempEraser || !d.stroke.id) {
      if (erasedRef.current.length) {
        pushAction({ type: 'erase', strokes: erasedRef.current })
        erasedRef.current = []
        afterChange()
      } else {
        redraw()
      }
      return
    }
    const pts = d.stroke.points
    if (end === 'discard' || !pts.length) {
      redraw()
      return
    }
    const tail = pts[pts.length - 1]
    if (last && tail && Math.hypot(tail.x - last.x, tail.y - last.y) > 0.5) pts.push({ x: last.x, y: last.y, p: tail.p, t: last.t })
    const scratchHit = detectScratchOut(d.stroke, strokesRef.current, estimateCharHeight(strokesRef.current))
    if (scratchHit.length) {
      const hitSet = new Set(scratchHit)
      const removed = strokesRef.current.filter((s) => hitSet.has(s.id))
      strokesRef.current = strokesRef.current.filter((s) => !hitSet.has(s.id))
      pushAction({ type: 'erase', strokes: removed })
      afterChange()
      return
    }
    strokesRef.current = [...strokesRef.current, d.stroke]
    pushAction({ type: 'add', strokes: [d.stroke] })
    afterChange(d.stroke)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 抓手工具或鼠标中键：单指针平移动作，支持横纵自由平移
    if (e.button === 1 || (toolRef.current === 'hand' && (e.pointerType !== 'mouse' || e.button === 0))) {
      if (drawingRef.current) finishDrawing('commit')
      if (lassoRef.current) {
        lassoRef.current = null
        redraw()
      }
      handPanRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        scrollX: scrollXRef.current,
        scrollY: scrollYRef.current,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    const kind = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse'
    const stylusEraser = kind === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0)
    const r = gestureRef.current.down({
      id: e.pointerId,
      kind,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      button: stylusEraser ? 0 : e.button,
      palm: kind === 'touch' && (e.width > 34 || e.height > 34 || e.width * e.height > 900),
    })
    if (gestureRef.current.penSeen) onPenLockChange(true)
    if (r.action === 'ignore') return
    if (r.action === 'pan') {
      if (r.interrupted && drawingRef.current?.pointerId === r.interrupted.pointerId) finishDrawing(r.interrupted.end)
      if (lassoRef.current) {
        lassoRef.current = null
        redraw()
      }
      const center = gestureRef.current.panCenter()
      panRef.current = {
        x: center.x,
        y: r.centerY,
        scrollX: scrollXRef.current,
        scrollY: scrollYRef.current,
        distance: gestureRef.current.touchDistance(),
        zoom: zoomRef.current,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    panRef.current = null
    e.currentTarget.setPointerCapture(e.pointerId)
    window.clearTimeout(idleTimer.current)
    const { x, y } = toWorld(e)
    if (toolRef.current === 'lasso' && !stylusEraser) {
      setSelected([])
      lassoRef.current = { pointerId: e.pointerId, points: [{ x, y }] }
      return
    }
    if (toolRef.current === 'eraser' || stylusEraser) {
      erasedRef.current = []
      drawingRef.current = { pointerId: e.pointerId, stroke: { id: '', points: [], width: 0 }, tempEraser: stylusEraser }
      eraseAt(x, y)
      return
    }
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    const color = penColorRef.current === 'auto' ? undefined : penColorRef.current
    const stroke: Stroke = {
      id: `${Date.now().toString(36)}-${uid().slice(0, 8)}`,
      points: [{ x, y, p, t: e.timeStamp }],
      width: penWidthRef.current,
      ...(color ? { color } : {}),
    }
    drawingRef.current = { pointerId: e.pointerId, stroke }
    // 落笔首点立即反馈：轻点小数点、乘号点时无延迟可见
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      const { dpr } = sizeRef.current
      const z = zoomRef.current
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -scrollXRef.current * dpr * z, -scrollYRef.current * dpr * z)
      const ink = resolveStrokeColor(stroke.color)
      ctx.strokeStyle = ink
      ctx.fillStyle = ink
      drawStroke(ctx, stroke)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = zoomRef.current
    if (handPanRef.current?.pointerId === e.pointerId) {
      const hp = handPanRef.current
      scrollTo(hp.scrollX + (hp.x - e.clientX) / z, hp.scrollY + (hp.y - e.clientY) / z)
      return
    }
    const g = gestureRef.current
    const m = g.move(e.pointerId, e.clientX, e.clientY)
    if (m && panRef.current) {
      const center = g.panCenter()
      const dist = g.touchDistance()
      if (dist != null && panRef.current.distance && panRef.current.distance > 12 && panRef.current.zoom) {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(panRef.current.zoom * (dist / panRef.current.distance) * 100) / 100))
        const rect = canvasRef.current?.getBoundingClientRect()
        const sx = rect ? panRef.current.x - rect.left : sizeRef.current.w / 2
        const sy = rect ? panRef.current.y - rect.top : sizeRef.current.h / 2
        const worldAnchorX = panRef.current.scrollX + sx / panRef.current.zoom
        const worldAnchorY = panRef.current.scrollY + sy / panRef.current.zoom
        const curSx = rect ? center.x - rect.left : sx
        const curSy = rect ? center.y - rect.top : sy
        if (Math.abs(nextZoom - zoomRef.current) >= 0.01) {
          zoomRef.current = nextZoom
          onZoomChange(nextZoom)
        }
        scrollTo(worldAnchorX - curSx / zoomRef.current, worldAnchorY - curSy / zoomRef.current)
        return
      }
      scrollTo(panRef.current.scrollX + (panRef.current.x - center.x) / z, panRef.current.scrollY + (panRef.current.y - m.panCenterY) / z)
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
    if (toolRef.current === 'eraser' || d.tempEraser) {
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
      const prev = pts[pts.length - 1]
      let p = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
      // 鼠标/手指/无压感笔按书写速度微调轻重，提升手写自然度
      if ((ev.pointerType !== 'pen' || Math.abs(p - 0.5) < 0.001) && prev) {
        const dt = Math.max(1, ev.timeStamp - prev.t)
        const speed = Math.hypot(x - prev.x, y - prev.y) / dt
        p = Math.max(0.36, Math.min(0.62, 0.58 - speed * 0.14))
      }
      smoothAppend(pts, { x, y, p, t: ev.timeStamp } as InkPoint)
    }
    if (ctx && pts.length > before) {
      const { dpr } = sizeRef.current
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -scrollXRef.current * dpr * z, -scrollYRef.current * dpr * z)
      const ink = resolveStrokeColor(d.stroke.color)
      ctx.strokeStyle = ink
      ctx.fillStyle = ink
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      drawStroke(ctx, d.stroke, Math.max(1, before - 1))
    }
  }

  /** pointerup / pointercancel / lostpointercapture 共用 */
  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (handPanRef.current?.pointerId === e.pointerId) {
      handPanRef.current = null
      return
    }
    const cancelled = e.type !== 'pointerup'
    const r = gestureRef.current.up(e.pointerId, cancelled)
    if (lassoRef.current?.pointerId === e.pointerId) {
      const polygon = lassoRef.current.points
      lassoRef.current = null
      if (!cancelled) setSelected(selectInLasso(strokesRef.current, polygon))
      redraw()
    }
    if (r.action === 'panRebase') {
      const center = gestureRef.current.panCenter()
      panRef.current = {
        x: center.x,
        y: r.centerY,
        scrollX: scrollXRef.current,
        scrollY: scrollYRef.current,
        distance: gestureRef.current.touchDistance(),
        zoom: zoomRef.current,
      }
    } else if (r.action === 'endPan') {
      panRef.current = null
    } else if (r.action === 'endDraw' && drawingRef.current?.pointerId === e.pointerId) {
      finishDrawing(r.end, r.end === 'commit' ? { ...toWorld(e), t: e.timeStamp } : undefined)
    }
    if (gestureRef.current.mode === 'idle') {
      if (drawingRef.current) finishDrawing('discard')
      panRef.current = null
    }
  }

  return { redraw, drawingRef, gestureRef, panRef, scrollTo, zoomAt, unlockFinger, onPointerDown, onPointerMove, onPointerEnd }
}
