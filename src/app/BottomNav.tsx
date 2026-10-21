import { NavLink, useLocation } from 'react-router'
import { NAV_ITEMS } from './nav'
import { countByTier, useAllTasks } from '@/db/hooks'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

/** 手机/平板竖屏底部导航：玻璃材质 + 安全区适配 + 会滑动的药丸指示器 */
export function BottomNav() {
  const all = useAllTasks()
  const counts = countByTier(all)
  const { pathname } = useLocation()
  const section = `/${pathname.split('/')[1] || ''}`
  const activeIndex = NAV_ITEMS.findIndex((item) => item.path === section)
  const slotPct = 100 / NAV_ITEMS.length

  return (
    <nav className="glass md:hidden sticky bottom-0 z-20 flex border-t border-outline/70 pb-[env(safe-area-inset-bottom)] relative">
      {/* 单颗会滑动的药丸：切页时从左/右流过去，而不是每项各自闪一下背景 */}
      <span
        aria-hidden
        className="absolute top-1.5 h-8 w-16 rounded-full bg-primary-soft transition-[left,opacity] duration-300 ease-spring pointer-events-none"
        style={{
          left: `${(Math.max(0, activeIndex) + 0.5) * slotPct}%`,
          transform: 'translateX(-50%)',
          opacity: activeIndex < 0 ? 0 : 1,
        }}
      />
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
                  <span key={String(isActive)} className={cn('grid place-items-center', isActive && 'nav-pop')}>
                    <item.icon size={21} strokeWidth={isActive ? 2.2 : 1.9} />
                  </span>
                  {badge > 0 && (
                    <span
                      key={badge}
                      className="nav-pop absolute -top-0.5 right-3 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10.5px] font-semibold tabular-nums leading-none"
                      aria-label={`今日待办 ${badge} 件`}
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                <span className={cn('relative z-[1] text-[11px] leading-none mt-0.5 transition-colors duration-150', isActive && 'font-semibold text-primary')}>{item.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
