import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

/**
 * 路由切换的顶部细进度条（ui-motion「顶部进度条 Top Progress Bar」）。
 *
 * 本应用是纯静态 + 本地数据，没有真实网络等待，所以进度不假装「按流量走」，
 * 只做两件事：路由一变立刻出现一条 8% 的线（给「点了，正在响」的即时反馈），
 * 然后在 260ms / 520ms 两段走到 70% / 100% 并淡出 —— 先快后慢，收尾不拖。
 * 减弱动效时直接不渲染。
 */
export function RouteProgress() {
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)
  const [pct, setPct] = useState(0)
  const first = useRef(true)

  useEffect(() => {
    // 首屏不播：刚打开就闪一条线反而像是加载失败
    if (first.current) { first.current = false; return }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setVisible(true)
    setPct(8)
    const t1 = window.setTimeout(() => setPct(70), 260)
    const t2 = window.setTimeout(() => setPct(100), 520)
    const t3 = window.setTimeout(() => setVisible(false), 760)
    const t4 = window.setTimeout(() => setPct(0), 1000)
    return () => { [t1, t2, t3, t4].forEach(window.clearTimeout) }
  }, [pathname])

  if (!visible) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-[2px] pointer-events-none" aria-hidden>
      <div
        className="h-full bg-primary origin-left"
        style={{
          width: `${pct}%`,
          transition: `width ${pct === 8 ? 120 : 300}ms cubic-bezier(.22,.61,.36,1), opacity 240ms linear`,
          opacity: pct === 100 ? 0 : 1,
          boxShadow: '0 0 8px color-mix(in srgb, var(--primary) 60%, transparent)',
        }}
      />
    </div>
  )
}
