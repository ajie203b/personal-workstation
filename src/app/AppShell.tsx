import { Outlet, useLocation } from 'react-router'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { NAV_ITEMS } from './nav'
import { useThemeEffect } from '@/shared/theme'

export const PAGE_TITLE: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((n) => [n.path, n.label]),
)

export function AppShell() {
  useThemeEffect()
  const { pathname } = useLocation()
  const title = PAGE_TITLE[`/${pathname.split('/')[1]}`] ?? '个人工作站'

  // 路由切换回顶部
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="h-full flex bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main id="main-scroll" className="flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  )
}
