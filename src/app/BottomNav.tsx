import { NavLink } from 'react-router'
import { NAV_ITEMS } from './nav'
import { cn } from '@/lib/cn'

/** 手机/平板竖屏底部导航：玻璃材质 + 安全区适配 + MD3 药丸指示 */
export function BottomNav() {
  return (
    <nav className="glass md:hidden sticky bottom-0 z-20 flex border-t border-outline/70 pb-[env(safe-area-inset-bottom)]">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 h-14 min-h-[56px] select-none pt-1.5',
              'transition-colors duration-150',
              isActive ? 'text-primary' : 'text-on-surface-2',
            )
          }
        >
          {({ isActive }) => (
            <>
              {/* MD3 药丸指示器：活跃态图标背景 + 切换时弹跳（nav-pop） */}
              <span
                className={cn(
                  'grid place-items-center w-16 h-8 rounded-full transition-all duration-200',
                  isActive ? 'bg-primary-soft scale-105' : 'bg-transparent',
                )}
              >
                <span key={String(isActive)} className={cn('grid place-items-center', isActive && 'nav-pop')}>
                  <item.icon size={21} strokeWidth={isActive ? 2.2 : 1.9} />
                </span>
              </span>
              <span className={cn('text-[11px] leading-none mt-0.5 transition-colors duration-150', isActive && 'font-semibold text-primary')}>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
