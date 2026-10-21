import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { NAV_ITEMS } from './nav'
import { countByTier, useAllTasks } from '@/db/hooks'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

/** 手机/平板竖屏底部导航：玻璃材质 + 安全区适配 + 会流过去的水滴胶囊 */
export function BottomNav() {
  const all = useAllTasks()
  const counts = countByTier(all)
  const { pathname } = useLocation()
  const section = `/${pathname.split('/')[1] || ''}`
  const activeIndex = NAV_ITEMS.findIndex((item) => item.path === section)
  const navRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const prevIndex = useRef(activeIndex)
  const moveTimer = useRef(0)
  const [ready, setReady] = useState(false)
  const [pill, setPill] = useState({ left: 0, right: 0 })
  // 渲染时读上一帧的下标来决定「哪条边先走」，不能用 effect 里的新值
  const dir = activeIndex >= prevIndex.current ? 'right' : 'left'

  // 胶囊左右边缘分别落位；宽度随两边的差值实时拉伸，不做整块平移
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const slot = nav.clientWidth / NAV_ITEMS.length
      const i = Math.max(0, activeIndex)
      const center = (i + 0.5) * slot
      const half = 32 // 胶囊底宽 w-16
      setPill({ left: center - half, right: center + half })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [activeIndex])

  // 首帧只落位不播放：稍后打开过渡，避免胶囊从 0 宽度长出来
  useEffect(() => {
    if (ready) return
    const t = window.setTimeout(() => setReady(true), 80)
    return () => window.clearTimeout(t)
  }, [ready])

  useLayoutEffect(() => {
    if (prevIndex.current === activeIndex) return
    prevIndex.current = activeIndex
    const el = pillRef.current
    if (!el) return
    el.dataset.moving = 'true'
    window.clearTimeout(moveTimer.current)
    moveTimer.current = window.setTimeout(() => { delete el.dataset.moving }, 260)
    return () => window.clearTimeout(moveTimer.current)
  }, [activeIndex])

  return (
    <nav
      ref={navRef}
      className="glass md:hidden sticky bottom-0 z-20 flex border-t border-outline/70 pb-[env(safe-area-inset-bottom)] relative"
    >
      <span
        ref={pillRef}
        aria-hidden
        data-ready={ready || undefined}
        className="tab-pill"
        style={{
          '--pill-l': pill.left,
          '--pill-r': pill.right,
          // 往右切：左沿先走、右沿晚 60ms；往左切反之。差值把胶囊自然拉长再收回
          '--pill-dl': dir === 'right' ? '0ms' : '32ms',
          '--pill-dr': dir === 'right' ? '32ms' : '0ms',
          opacity: activeIndex < 0 ? 0 : 1,
        } as React.CSSProperties}
      >
        <span className="tab-pill-fill" />
      </span>
      {NAV_ITEMS.map((item) => {
        // 今日待办数挂在「任务清单」上：底栏原来完全没有角标，得点进去才知道有多少
        const badge = item.path === '/tasks' ? counts.today : 0
        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => haptic('selection')}
            className={({ isActive }) =>
              cn(
                'relative overflow-hidden flex-1 flex flex-col items-center justify-center gap-0.5 h-14 min-h-[56px] select-none pt-1.5',
                'transition-colors duration-150',
                isActive ? 'text-primary' : 'text-on-surface-2',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative z-[1] grid place-items-center w-16 h-8 rounded-full">
                  <span className="grid place-items-center">
                    <item.icon size={22} strokeWidth={isActive ? 2 : 1.8} aria-hidden />
                  </span>
                  {item.path === '/tasks' && <NavBadge value={badge} />}
                </span>
                <span className={cn('relative z-[1] text-[12px] leading-none mt-0.5 transition-colors duration-150', isActive && 'font-medium text-primary')}>{item.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

/** 待办角标：数字像计数器一样从下方翻上来，清零时缩小淡出 */
function NavBadge({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (value > 0) {
      setShown(value)
      setLeaving(false)
      return
    }
    if (shown <= 0) return
    setLeaving(true)
    const t = window.setTimeout(() => {
      setShown(0)
      setLeaving(false)
    }, 220)
    return () => window.clearTimeout(t)
  }, [value, shown])

  if (shown <= 0) return null
  const text = shown > 99 ? '99+' : String(shown)
  return (
    <span
      key={shown}
      role="status"
      aria-label={`今日待办 ${shown} 件`}
      className={cn(
        'nav-badge absolute -top-0.5 right-3 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[11px] font-medium tabular-nums leading-none overflow-hidden',
        leaving && 'nav-badge-out',
      )}
    >
      <span className="nav-badge-num">{text}</span>
    </span>
  )
}
