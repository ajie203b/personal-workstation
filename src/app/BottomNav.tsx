import { NavLink } from 'react-router'
import { NAV_ITEMS } from './nav'
import { cn } from '@/lib/cn'

/** 手机/平板竖屏底部导航：玻璃材质 + 安全区适配 + 44px 触摸目标 + 活动态指示条 */
export function BottomNav() {
  return (
    <nav className="glass md:hidden sticky bottom-0 z-20 flex border-t border-outline/70 pb-[env(safe-area-inset-bottom)]">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 h-14 min-h-[56px] select-none',
              'transition-colors duration-150',
              isActive ? 'text-primary' : 'text-on-surface-2',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                <item.icon size={21} strokeWidth={isActive ? 2.2 : 1.9} className={cn('transition-transform duration-200', isActive && '-translate-y-0.5')} />
                {isActive && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-[3px] rounded-full bg-primary transition-all" />}
              </span>
              <span className={cn('text-[11px] leading-none', isActive && 'font-semibold text-primary')}>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
