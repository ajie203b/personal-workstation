import { NavLink, useLocation, useNavigate } from 'react-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { IconSettings } from '@/shared/icons'
import { NAV_ITEMS } from './nav'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { modKeyLabel } from '@/lib/shortcut'
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
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const [readerExpanded, setReaderExpanded] = useState(false)
  const reading = /^\/docs\/.+/.test(pathname)
  const collapsed = reading ? !readerExpanded : savedCollapsed
  const setCollapsed = useUi((s) => s.setSidebarCollapsed)
  const modK = modKeyLabel('K')

  const badgeText = todayCount > 99 ? '99+' : String(todayCount)

  return (
    <aside
      className={cn(
        'workspace-sidebar hidden md:flex flex-col shrink-0 w-[68px] z-30 ml-3 mb-3 mt-[calc(.75rem+env(safe-area-inset-top,0px))]',
        !collapsed && 'lg:w-[228px]',
      )}
    >
      <div className="flex items-center h-14 px-2.5 pt-1 shrink-0">
        <button
          type="button"
          aria-label="Kairos 全局搜索与快速跳转"
          aria-haspopup="dialog"
          data-tip={`全局搜索（${modK}）`}
          onClick={() => setPaletteOpen(true)}
          className={cn(
            'chrome-button tip press flex items-center gap-1.5 h-11 rounded-[14px] cursor-pointer select-none transition-colors',
            collapsed ? 'w-11 justify-center mx-auto' : 'w-11 justify-center mx-auto lg:mx-0 lg:w-full lg:justify-start lg:px-1',
          )}
        >
          <BrandMark />
          {!collapsed && (
            <>
              <span className="sidebar-label hidden lg:block text-[18px] font-bold tracking-[-0.03em] text-on-surface whitespace-nowrap">
                Kairos
              </span>
              <kbd className="sidebar-label hidden lg:inline-block ml-auto rounded-[6px] bg-surface/90 px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-on-surface-2/85 border border-outline/75">
                {modK}
              </kbd>
            </>
          )}
        </button>
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
                'sidebar-link relative flex items-center h-11 rounded-[14px] shrink-0',
                collapsed ? 'justify-center px-0' : 'justify-center px-0 lg:justify-start lg:gap-3 lg:px-3',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-on-surface-2 hover:bg-surface-3/70 hover:text-on-surface',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative grid place-items-center size-6 shrink-0">
                  <item.icon size={20} strokeWidth={isActive ? 2.1 : 1.8} className="shrink-0" aria-hidden />
                  {item.path === '/tasks' && todayCount > 0 && (
                    <span
                      aria-hidden={!collapsed ? undefined : false}
                      className={cn(
                        'absolute -top-1 -right-2 grid place-items-center min-w-4 h-4 px-1 rounded-full bg-primary text-on-primary text-[10px] font-semibold tabular-nums leading-none ring-2 ring-surface',
                        !collapsed && 'lg:hidden',
                      )}
                    >
                      {badgeText}
                    </span>
                  )}
                </span>
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
                    {badgeText}
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
