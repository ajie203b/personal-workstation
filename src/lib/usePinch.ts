import { useEffect, useRef } from 'react'

export interface PinchOptions {
  /** 双指按下，准备开始 */
  onStart?: () => void
  /** 相对手势起点的倍数（1 = 没变），mid 为视口坐标 */
  onScale: (ratio: number, mid: { x: number; y: number }) => void
  /** 手指离开，报告最终倍数 */
  onEnd: (ratio: number) => void
}

/**
 * 文档内双指缩放（v2.1）。
 * - 只报告相对倍数，放大什么由调用方决定：PDF 改页宽，正文改字号
 * - touchmove 用非 passive 监听并 preventDefault，把浏览器自己的整页缩放挡在门外
 *   （配合 viewport 的 user-scalable=no 与容器的 touch-action: pan-x pan-y）
 * - 单指滚动完全不干预，长按选词照常
 */
export function usePinch(ref: React.RefObject<HTMLElement | null>, handlers: PinchOptions): void {
  const cb = useRef(handlers)
  cb.current = handlers

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let startDist = 0
    let ratio = 1
    let active = false

    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    })

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      active = true
      startDist = dist(e.touches)
      ratio = 1
      cb.current.onStart?.()
    }
    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 2) return
      e.preventDefault()
      if (startDist <= 0) return
      ratio = Math.max(0.25, Math.min(4, dist(e.touches) / startDist))
      cb.current.onScale(ratio, mid(e.touches))
    }
    const onEnd = (e: TouchEvent) => {
      if (!active) return
      if (e.touches.length >= 2) return
      active = false
      cb.current.onEnd(ratio)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [ref])
}
