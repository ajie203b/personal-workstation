import { NavLink } from 'react-router'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { NAV_ITEMS } from './nav'
import { countByTier, useAllTasks } from '@/db/hooks'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { ThemeButton } from './ThemeButton'

/**
 * 左侧导航：
 * - ≥lg：完整侧栏（可折叠成图标栏，状态持久化）
 * - md（平板竖屏 / 窄窗口）：图标栏
 * - <md：隐藏，由底部导航接管
 */
export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const setCollapsed = useUi((s) => s.setSidebarCollapsed)
  const all = useAllTasks()
  const counts = countByTier(all)

  return (
    <aside
      className={cn(
        'glass hidden md:flex flex-col shrink-0 border-r border-outline/70 z-10',
        'transition-[width] duration-300 ease-standard',
        collapsed ? 'w-16' : 'w-16 lg:w-60',
      )}
    >
      <div className="flex items-center gap-2.5 h-14 px-3.5 shrink-0">
        <div className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary text-on-primary text-[15px] font-bold shrink-0">
          工
        </div>
        {!collapsed && (
          <span className="hidden lg:block text-[15px] font-semibold tracking-wide">个人工作站</span>
        )}
        <button
          type="button"
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:grid place-items-center ml-auto w-8 h-8 rounded-lg text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-2.5 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 h-11 px-2.5 rounded-[12px] shrink-0',
                'transition-colors duration-150',
                isActive
                  ? 'bg-primary-soft text-primary font-medium'
                  : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={19} strokeWidth={isActive ? 2.2 : 1.9} className="shrink-0" />
                <span className={cn('hidden lg:block text-[13.5px] truncate', collapsed && 'lg:hidden')}>
                  {item.label}
                </span>
                {item.path === '/tasks' && counts.today > 0 && (
                  <span
                    className={cn(
                      'hidden lg:grid place-items-center ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px]',
                      collapsed && 'lg:hidden',
                      isActive ? 'bg-primary text-on-primary' : 'bg-surface-3 text-on-surface-2',
                    )}
                  >
                    {counts.today}
                  </span>
                )}
                {item.milestone && (
                  <span
                    className={cn(
                      'hidden lg:block ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 text-on-surface-2',
                      collapsed && 'lg:hidden',
                    )}
                  >
                    {item.milestone}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-1 px-2.5 py-3 shrink-0">
        <ThemeButton compact={collapsed} />
      </div>
    </aside>
  )
}
