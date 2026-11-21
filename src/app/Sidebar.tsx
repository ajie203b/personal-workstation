import { NavLink, useLocation, useNavigate } from 'react-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { IconSettings } from '@/shared/icons'
import { NAV_ITEMS } from './nav'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { ThemeButton } from './ThemeButton'
import { useState } from 'react'
import { BrandMark } from '@/shared/BrandMark'
import { guardNavigation } from '@/lib/unsavedGuard'

/**
 * 左侧导航：
 * - ≥lg：完整侧栏（可折叠成图标栏，状态持久化）
 * - md（平板竖屏 / 窄窗口）：图标栏
 * - <md：隐藏，由底部导航接管
 * 侧栏宽度一次落位，文档视口只需按最终宽度重排。
 */
export function Sidebar({ todayCount }: { todayCount: number }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const savedCollapsed = useUi((s) => s.sidebarCollapsed)
  const [readerExpanded, setReaderExpanded] = useState(false)
  const reading = /^\/docs\/.+/.test(pathname)
  const collapsed = reading ? !readerExpanded : savedCollapsed
  const setCollapsed = useUi((s) => s.setSidebarCollapsed)

  const onBrandClick = () => guardNavigation(() => navigate('/today'))

  return (
    <aside
      className={cn(
        'workspace-sidebar hidden md:flex flex-col shrink-0 w-[68px] z-30 overflow-hidden ml-3 mb-3 mt-[calc(.75rem+env(safe-area-inset-top,0px))]',
        !collapsed && 'lg:w-[228px]',
      )}
    >
      <div className="flex items-center gap-1.5 h-15 px-2.5 shrink-0 overflow-hidden">
        <button
          type="button"
          aria-label="回到今日"
          title="今日"
          onClick={onBrandClick}
          className="chrome-button press shrink-0 cursor-pointer rounded-2xl select-none"
        >
          <BrandMark />
        </button>
        {!collapsed && (
          <div className="sidebar-label hidden lg:flex flex-col min-w-0 leading-none">
            <span className="text-[17px] font-bold tracking-[-0.025em] text-on-surface whitespace-nowrap">
              Kairos
            </span>
            <span className="text-[10.5px] font-medium tracking-[0.06em] uppercase text-on-surface-2/80 mt-0.5 whitespace-nowrap">
              Workstation
            </span>
          </div>
        )}
      </div>

      <nav aria-label="主导航" className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 px-2.5 py-1.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            aria-label={item.label}
            onClick={() => haptic('selection')}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'sidebar-link relative flex items-center gap-3 h-11 px-3 rounded-[14px] shrink-0',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-on-surface-2 hover:bg-surface-3/70 hover:text-on-surface',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} strokeWidth={isActive ? 2.1 : 1.8} className="shrink-0" aria-hidden />
                <span
                  className={cn('sidebar-label text-ui-label whitespace-nowrap', collapsed ? 'hidden' : 'hidden lg:block')}
                >
                  {item.label}
                </span>
                {!collapsed && item.path === '/tasks' && todayCount > 0 && (
                  <span
                    className={cn(
                      'sidebar-label hidden lg:grid place-items-center ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums',
                      isActive ? 'bg-primary text-on-primary' : 'bg-surface-3 text-on-surface-2',
                    )}
                  >
                    {todayCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn('flex items-center gap-1 px-2.5 py-2.5 border-t border-outline/80 shrink-0 flex-col', !collapsed && 'lg:flex-row')}>
        <button
          type="button"
          aria-label={pathname.startsWith('/settings') ? '返回' : '设置'}
          title={pathname.startsWith('/settings') ? '返回' : '设置'}
          onClick={() => guardNavigation(() => navigate(pathname.startsWith('/settings') ? '/today' : '/settings'))}
          className={cn(
            'chrome-button press grid place-items-center size-10 rounded-[12px] shrink-0 cursor-pointer',
            pathname.startsWith('/settings') ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3/70 hover:text-on-surface',
          )}
        >
          <IconSettings size={18} />
        </button>
        <ThemeButton compact={collapsed} />
        <button
          type="button"
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
          aria-expanded={!collapsed}
          onClick={() => reading ? setReaderExpanded(collapsed) : setCollapsed(!collapsed)}
          className="chrome-button press hidden lg:grid place-items-center size-10 rounded-[12px] text-on-surface-2 shrink-0 lg:ml-auto cursor-pointer"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
    </aside>
  )
}
