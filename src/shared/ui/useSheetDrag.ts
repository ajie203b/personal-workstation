import { useLayoutEffect, useRef, type PointerEvent } from 'react'
import { haptic } from '@/lib/haptics'

type Drag = {
  pointerId: number
  axis: 'x' | 'y'
  start: number
  origin: number
  offset: number
  last: number
  time: number
  velocity: number
  moved: boolean
}

/** 把手独占拖动手势，滚动区仍由浏览器处理。每帧只更新弹层位移和遮罩透明度。 */
export function useSheetDrag(open: boolean, onDismiss: () => void, sideOnDesktop = false) {
  const panelRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Drag | null>(null)
  const frame = useRef(0)

  useLayoutEffect(() => {
    if (open) {
      const panel = panelRef.current
      const overlay = overlayRef.current
      if (panel) {
        delete panel.dataset.dragMotion
        panel.style.removeProperty('--sheet-offset')
      }
      if (overlay) {
        delete overlay.dataset.dragMotion
        overlay.style.removeProperty('--sheet-opacity')
      }
    }
    return () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      gesture.current = null
    }
  }, [open])

  function paint(offset: number) {
    panelRef.current?.style.setProperty('--sheet-offset', `${offset}px`)
    overlayRef.current?.style.setProperty('--sheet-opacity', String(Math.max(.18, 1 - offset / 360)))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current
    if (!event.isPrimary || event.button !== 0 || gesture.current || panel?.dataset.state !== 'open') return
    if ((event.target as Element).closest('button')) return
    const axis = sideOnDesktop && window.matchMedia('(min-width: 768px)').matches ? 'x' : 'y'
    const start = axis === 'x' ? event.clientX : event.clientY
    gesture.current = {
      pointerId: event.pointerId, axis, start, origin: 0, offset: 0,
      last: start, time: event.timeStamp, velocity: 0, moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current
    const panel = panelRef.current
    if (!drag || drag.pointerId !== event.pointerId || panel?.dataset.state !== 'open') return
    const position = drag.axis === 'x' ? event.clientX : event.clientY
    const delta = position - drag.start
    if (!drag.moved) {
      if (delta < 4) return
      const transform = getComputedStyle(panel).transform
      if (transform !== 'none' && typeof DOMMatrixReadOnly !== 'undefined') {
        const matrix = new DOMMatrixReadOnly(transform)
        drag.origin = drag.axis === 'x' ? matrix.m41 : matrix.m42
      }
      drag.moved = true
      panel.dataset.dragMotion = 'dragging'
      if (overlayRef.current) overlayRef.current.dataset.dragMotion = 'dragging'
    }
    const elapsed = event.timeStamp - drag.time
    if (elapsed > 0) drag.velocity = (position - drag.last) / elapsed
    drag.last = position
    drag.time = event.timeStamp
    drag.offset = Math.max(0, drag.origin + delta)
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      paint(drag.offset)
    })
  }

  function finish(event: PointerEvent<HTMLDivElement>, canceled = false) {
    const drag = gesture.current
    if (!drag || drag.pointerId !== event.pointerId) return
    gesture.current = null
    if (!drag.moved) return
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const distance = drag.last - drag.start
    const flick = distance > 24 && event.timeStamp - drag.time < 90 && drag.velocity > .55
    if (!canceled && (distance > 92 || flick)) {
      paint(drag.offset)
      haptic('light')
      onDismiss()
      return
    }
    if (panelRef.current) panelRef.current.dataset.dragMotion = 'settled'
    if (overlayRef.current) overlayRef.current.dataset.dragMotion = 'settled'
    paint(0)
  }

  return {
    panelRef,
    overlayRef,
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    },
  }
}
