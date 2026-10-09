import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface RippleItem {
  id: number
  x: number
  y: number
  size: number
}

/**
 * 触点水波纹：从指针坐标生成一个扩散圆，480ms 后自动清理。
 * 宿主元素需要 `position: relative; overflow: hidden`，并在内部渲染
 * `ripples.map(r => <span className="ripple" style={{left,top,width,height}} />)`。
 * reduced-motion 由全局 CSS 把 .ripple 直接 display:none 掉，这里不再判断。
 */
export function useRipple() {
  const [ripples, setRipples] = useState<RippleItem[]>([])
  const seed = useRef(0)

  const spawn = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const id = ++seed.current
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left - size / 2, y: e.clientY - rect.top - size / 2, size }])
    window.setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 480)
  }, [])

  return { ripples, spawn }
}
