import { NavLink, useLocation, useNavigate } from 'react-router'
import { ChevronsLeft, ChevronsRight, Settings } from 'lucide-react'
import { NAV_ITEMS } from './nav'
import { countByTier, useAllTasks } from '@/db/hooks'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { ThemeButton } from './ThemeButton'

/**
 * 左侧导航：
 * - ≥lg：完整侧栏（可折叠成图标栏，状态持久化）
 * - md（平板竖屏 / 窄窗口）：图标栏
 * - <md：隐藏，由底部导航接管
 *
 * 折叠动画改的是 width（不是 translateX）：以前只把内容左移 176px、宽度仍是 w-60，
 * 右侧就留一条空白。现在宽度从 240 → 64 过渡，内容区自动补位。
 */
export function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const setCollapsed = useUi((s) => s.setSidebarCollapsed)
  const all = useAllTasks()
  const counts = countByTier(all)

  const onBrandClick = () => {
    if (pathname.startsWith('/settings')) navigate('/today')
    else navigate('/settings')
  }

  return (
    <aside
      className={cn(
        'glass hidden md:flex flex-col shrink-0 border-r border-outline/70 z-30 overflow-hidden',
        'w-16 transition-[width] duration-300 ease-standard',
        collapsed ? 'lg:w-16' : 'lg:w-60',
      )}
    >
      <div className="flex items-center gap-2.5 h-14 px-3 shrink-0 overflow-hidden">
        {/* 折叠后宽度只够放一个控件：品牌让位给「展开」，展开态两者都在 */}
        <button
          type="button"
          aria-label="进入设置（再点返回）"
          title="设置"
          onClick={onBrandClick}
          className={cn('shrink-0 cursor-pointer rounded-[10px] active:opacity-80 select-none', collapsed && 'lg:hidden')}
        >
          <img src="./brand.png" alt="" className="w-10 h-10 rounded-[10px] object-cover" draggable={false} />
        </button>
        <span
          className="hidden lg:block text-[15px] font-semibold tracking-wide overflow-hidden whitespace-nowrap transition-opacity duration-200"
          style={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : undefined }}
        >
          个人工作站
        </span>
        <button
          type="button"
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:grid place-items-center ml-auto w-8 h-8 rounded-lg text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors shrink-0"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-2.5 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => haptic('selection')}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 h-11 px-2.5 rounded-[12px] shrink-0 overflow-hidden',
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
                <span
                  className="hidden lg:block text-[13px] truncate transition-opacity duration-200"
                  style={{ opacity: collapsed ? 0 : 1 }}
                >
                  {item.label}
                </span>
                {item.path === '/tasks' && counts.today > 0 && (
                  <span
                    className={cn(
                      'hidden lg:grid place-items-center ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] transition-opacity duration-200 tabular-nums',
                      isActive ? 'bg-primary text-on-primary' : 'bg-surface-3 text-on-surface-2',
                    )}
                    style={{ opacity: collapsed ? 0 : 1 }}
                  >
                    {counts.today}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn('flex items-center gap-1 px-2.5 py-3 shrink-0', collapsed ? 'flex-col lg:flex-col' : 'flex-col lg:flex-row')}>
        <button
          type="button"
          aria-label={pathname.startsWith('/settings') ? '返回' : '设置'}
          title={pathname.startsWith('/settings') ? '返回' : '设置'}
          onClick={onBrandClick}
          className={cn(
            'grid place-items-center w-10 h-10 rounded-[10px] shrink-0 transition-colors cursor-pointer',
            pathname.startsWith('/settings') ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
          )}
        >
          <Settings size={18} strokeWidth={1.9} />
        </button>
        <ThemeButton compact={collapsed} />
      </div>
    </aside>
  )
}
