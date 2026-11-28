import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router'
import { NAV_ITEMS } from './nav'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { durMs, prefersReducedMotion } from '@/lib/motion'

/** 手机底栏的选中背景和标签共用等宽列，切换时只移动背景。 */
export function BottomNav({ todayCount }: { todayCount: number }) {
  const { pathname } = useLocation()
  const hiddenNavPaths = useUi((s) => s.hiddenNavPaths)
  const items = NAV_ITEMS.filter((item) => !hiddenNavPaths.includes(item.path))
  const section = `/${pathname.split('/')[1] || ''}`
  const activeIndex = items.findIndex((item) => item.path === section)
  return (
    <div className="mobile-dock-wrap pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden">
      {/* 渐隐层覆盖底栏后的滚动内容。 */}
      <div aria-hidden className="mobile-dock-scrim" />
      <nav
        aria-label="主导航"
        className="mobile-tab-bar glass pointer-events-auto relative grid"
        style={{ '--tab-count': items.length } as CSSProperties}
      >
        <span
          aria-hidden
          className="tab-pill"
          style={{
            transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
            opacity: activeIndex < 0 ? 0 : undefined,
          }}
        />
        {items.map((item) => {
          return (
            <NavLink
              key={item.path}
              to={item.path}
              aria-label={item.label}
              onClick={() => { if (item.path !== section) haptic('selection') }}
              className={({ isActive }) =>
                cn(
                  'mobile-tab-link relative flex min-w-0 h-[50px] flex-col items-center justify-center gap-[2px] rounded-full select-none',
                  isActive ? 'text-primary' : 'text-on-surface-2',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="mobile-tab-icon relative grid place-items-center size-6">
                    <item.icon size={19} strokeWidth={isActive ? 2.1 : 1.8} aria-hidden />
                    {item.path === '/tasks' && <NavBadge value={todayCount} />}
                  </span>
                  <span className={cn('text-[11px] leading-none tracking-[0.01em]', isActive ? 'font-semibold' : 'font-medium')}>
                    {item.path === '/docs' ? '文档' : item.path === '/tasks' ? '任务' : item.label}
                  </span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
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
    if (prefersReducedMotion()) {
      setShown(0)
      setLeaving(false)
      return
    }
    setLeaving(true)
    const t = window.setTimeout(() => {
      setShown(0)
      setLeaving(false)
    }, durMs('--dur-2', 220))
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
        'nav-badge absolute -top-0.5 -right-2 grid place-items-center min-w-4 h-4 px-1 rounded-full bg-primary text-on-primary text-[11px] font-semibold tabular-nums leading-none overflow-hidden ring-[1.5px] ring-surface',
        leaving && 'nav-badge-out',
      )}
    >
      <span className="nav-badge-num">{text}</span>
    </span>
  )
}
