import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router'
import { NAV_ITEMS } from './nav'
import { countByTier, useAllTasks } from '@/db/hooks'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { durMs, prefersReducedMotion } from '@/lib/motion'

/** 手机底栏的选中背景和标签共用等宽列，切换时只移动背景。 */
export function BottomNav() {
  const all = useAllTasks()
  const counts = countByTier(all)
  const { pathname } = useLocation()
  const section = `/${pathname.split('/')[1] || ''}`
  const activeIndex = NAV_ITEMS.findIndex((item) => item.path === section)
  return (
    <nav
      aria-label="主导航"
      className="mobile-tab-bar glass absolute inset-x-0 bottom-0 z-20 grid md:hidden"
      style={{ '--tab-count': NAV_ITEMS.length } as CSSProperties}
    >
      <span
        aria-hidden
        className="tab-pill"
        style={{
          transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
          opacity: activeIndex < 0 ? 0 : undefined,
        }}
      />
      {NAV_ITEMS.map((item) => {
        // 今日待办数挂在「任务清单」上：底栏原来完全没有角标，得点进去才知道有多少
        const badge = item.path === '/tasks' ? counts.today : 0
        return (
          <NavLink
            key={item.path}
            to={item.path}
            aria-label={item.label}
            onClick={() => { if (item.path !== section) haptic('selection') }}
            className={({ isActive }) =>
              cn(
                'mobile-tab-link relative flex min-w-0 h-14 flex-col items-center justify-center gap-0.5 rounded-full select-none',
                isActive ? 'text-primary' : 'text-on-surface-2',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="mobile-tab-icon relative grid place-items-center size-7">
                  <item.icon size={21} strokeWidth={isActive ? 2 : 1.8} aria-hidden />
                  {item.path === '/tasks' && <NavBadge value={badge} />}
                </span>
                <span className="text-[12px] font-medium leading-none">{item.path === '/docs' ? '文档' : item.path === '/tasks' ? '任务' : item.label}</span>
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
        'nav-badge absolute -top-0.5 left-[calc(100%-5px)] grid place-items-center min-w-[15px] h-[15px] px-0.5 rounded-full bg-primary text-on-primary text-[10px] font-medium tabular-nums leading-none overflow-hidden',
        leaving && 'nav-badge-out',
      )}
    >
      <span className="nav-badge-num">{text}</span>
    </span>
  )
}
