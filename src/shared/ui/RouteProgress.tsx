import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { prefersReducedMotion } from '@/lib/motion'
import { useUi } from '@/stores/ui'

/**
 * 路由切换的顶部细进度条（ui-motion「顶部进度条 Top Progress Bar」）。
 *
 * 本应用是纯静态 + 本地数据，没有真实网络等待，所以进度不假装「按流量走」，
 * 只做两件事：路由一变立刻出现一条 8% 的线（给「点了，正在响」的即时反馈），
 * 然后在 100ms / 220ms 两段走到 70% / 100% 并淡出。
 * 减弱动效时直接不渲染。
 */
export function RouteProgress() {
  const { pathname } = useLocation()
  const motion = useUi((s) => s.motion)
  const [visible, setVisible] = useState(false)
  const [pct, setPct] = useState(0)
  const first = useRef(true)

  useEffect(() => {
    // 首屏不播：刚打开就闪一条线反而像是加载失败
    if (first.current) { first.current = false; return }
    if (!motion || prefersReducedMotion()) { setVisible(false); return }
    setVisible(true)
    setPct(8)
    const t1 = window.setTimeout(() => setPct(70), 100)
    const t2 = window.setTimeout(() => setPct(100), 220)
    const t3 = window.setTimeout(() => setVisible(false), 360)
    const t4 = window.setTimeout(() => setPct(0), 420)
    return () => { [t1, t2, t3, t4].forEach(window.clearTimeout) }
  }, [pathname, motion])

  if (!visible) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-[2px] pointer-events-none" aria-hidden>
      <div
        className="h-full bg-primary origin-left"
        style={{
          transform: `scaleX(${pct / 100})`,
          transition: 'transform var(--dur-2) var(--ease-standard), opacity var(--dur-1) linear',
          opacity: pct === 100 ? 0 : 1,
        }}
      />
    </div>
  )
}
