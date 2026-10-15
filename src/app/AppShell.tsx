import { Outlet, useLocation } from 'react-router'
import { useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { PAGE_TITLE } from './nav'
import { useThemeEffect } from '@/shared/theme'
import { cn } from '@/lib/cn'

/**
 * 阅读器 / 编辑器自己接管滚动：PdfReader 的窗口渲染、三种阅读器的进度与位置记忆
 * 全都挂在自己的滚动容器（scrollRef + onScroll）上。
 * 这些路由下 main 必须退出滚动 —— 否则「高度由内容决定」的父级里 h-full 会按规范
 * 解析成 auto，阅读容器被内容撑到全高、滚动条落到 main 上，内层 onScroll 一次都不触发
 * （表现：PDF 只渲染前 3 页，后面全白；docx 划不动；位置恢复与目录跳转失效）。
 */
const SELF_SCROLLING = /^\/docs\//

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

  const selfScrolling = SELF_SCROLLING.test(pathname)

  return (
    <div className="h-full flex bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main
          id="main-scroll"
          className={cn(
            'flex-1 min-h-0',
            selfScrolling ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain',
          )}
        >
          <div className={cn(selfScrolling && 'h-full', revisiting && 'enter-once')}>
            <Outlet />
          </div>
        </main>
        <BottomNav />
      </div>
    </div>
  )
}
