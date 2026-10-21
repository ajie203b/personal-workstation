import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { prefersReducedMotion } from './motion'

/**
 * 卡片按下微倾（ui-motion 65）：只给桌面鼠标用，触屏保持原生按压。
 * 倾斜方向跟随指针相对卡片中心的位置，松手用轻微回弹复位。
 */
export function usePressTilt<T extends HTMLElement>(maxDeg = 7) {
  const ref = useRef<T>(null)
  const active = useRef<number | null>(null)

  const place = (e: ReactPointerEvent<T>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    const rx = (0.5 - py) * maxDeg * 2
    const ry = (px - 0.5) * maxDeg * 2
    el.style.transition = 'none' // 按住时 1:1 跟手，松手再走回弹
    el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(0.97)`
    el.style.setProperty('--tilt-x', `${(px * 100).toFixed(1)}%`)
    el.style.setProperty('--tilt-y', `${(py * 100).toFixed(1)}%`)
  }

  const reset = () => {
    active.current = null
    const el = ref.current
    if (!el) return
    el.style.transition = 'transform 380ms cubic-bezier(.34,1.28,.64,1)'
    el.style.transform = ''
  }

  const onPointerDown = (e: ReactPointerEvent<T>) => {
    if (e.pointerType !== 'mouse' || prefersReducedMotion()) return
    active.current = e.pointerId
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 合成事件/旧 WebView 不支持捕获 */ }
    place(e)
  }

  const onPointerMove = (e: ReactPointerEvent<T>) => {
    if (active.current === e.pointerId) place(e)
  }

  return {
    ref,
    tiltProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: reset,
      onPointerCancel: reset,
      onPointerLeave: reset,
    },
  }
}
