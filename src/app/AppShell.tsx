import { Outlet, useLocation } from 'react-router'
import { useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { PAGE_TITLE } from './nav'
import { useThemeEffect } from '@/shared/theme'
import { cn } from '@/lib/cn'

export function AppShell() {
  useThemeEffect()
  const { pathname } = useLocation()
  const title = PAGE_TITLE[`/${pathname.split('/')[1]}`] ?? '个人工作站'
  const section = `/${pathname.split('/')[1] || ''}`

  // 同一会话内重复进入某视图时不再重放入场动画（P0：去掉反复切页的「晃」）
  const seen = useRef(new Set<string>())
  const revisiting = seen.current.has(section)

  // 路由切换回顶部
  useEffect(() => {
    seen.current.add(section)
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [pathname, section])

  return (
    <div className="h-full flex bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main id="main-scroll" className="flex-1 overflow-y-auto overscroll-contain">
          <div className={cn(revisiting && 'enter-once')}>
            <Outlet />
          </div>
        </main>
        <BottomNav />
      </div>
    </div>
  )
}
