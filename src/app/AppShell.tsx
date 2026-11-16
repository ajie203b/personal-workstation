import { Outlet, useLocation, useSearchParams } from 'react-router'
import { Suspense, useLayoutEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { PAGE_TITLE } from './nav'
import { useThemeEffect } from '@/shared/theme'
import { PageSkeleton } from '@/shared/ui/Skeleton'
import { FocusMiniBar } from '@/shared/FocusMiniBar'
import { useUi } from '@/stores/ui'
import { TIERS, type Tier } from '@/db/db'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'

/**
 * 阅读器 / 编辑器自己接管滚动：PdfReader 的窗口渲染、三种阅读器的进度与位置记忆
 * 全都挂在自己的滚动容器（scrollRef + onScroll）上。
 * 这些路由下 main 必须退出滚动 —— 否则「高度由内容决定」的父级里 h-full 会按规范
 * 解析成 auto，阅读容器被内容撑到全高、滚动条落到 main 上，内层 onScroll 一次都不触发
 * （表现：PDF 只渲染前 3 页，后面全白；docx 划不动；位置恢复与目录跳转失效）。
 */
const SELF_SCROLLING = /^\/(docs\/|tools\/math-notes$)/

/**
 * 沉浸模式：阅读器 / 编辑器自己带工具栏，全局顶栏与底栏全部让位。
 * 手机上原来顶栏 56 + 阅读器工具栏 56 + 底栏 56 ≈ 170px 被三套壳吃掉，正文只剩一条缝。
 * 手写计算同理：画布要尽量大，手机上整屏都给它。
 */
const IMMERSIVE = [/^\/docs\/.+/, /^\/tools\/math-notes$/]

export function AppShell() {
  useThemeEffect()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const openAddSheet = useUi((s) => s.openAddSheet)
  const section = `/${pathname.split('/')[1] || ''}`
  const title = PAGE_TITLE[pathname] ?? PAGE_TITLE[section] ?? 'Kairos'

  // 同一会话内重复进入某视图时不再重放入场动画（P0：去掉反复切页的「晃」）
  const seen = useRef(new Set<string>())
  const revisiting = seen.current.has(section)
  const mainRef = useRef<HTMLElement>(null)

  // 在新视图绘制前复位，避免继承上一页的滚动位置。
  useLayoutEffect(() => {
    seen.current.add(section)
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [pathname, section])

  const selfScrolling = SELF_SCROLLING.test(pathname)
  const immersive = IMMERSIVE.some((re) => re.test(pathname))
  const showTopBar = !immersive && pathname !== '/docs'
  // 设置页 / 工具页是配置与工具页，不摆「加任务」的悬浮按钮
  const showFab = !immersive && (section === '/today' || section === '/tasks')

  // 悬浮按钮的默认归属：今日页进「今日」，任务页跟随当前页签，其余落「随时」
  const onAdd = () => {
    haptic('light')
    if (section === '/today') return openAddSheet({ tier: 'today', todayContext: true })
    if (section === '/tasks') {
      const t = params.get('tier')
      return openAddSheet({ tier: (TIERS as readonly string[]).includes(t ?? '') ? (t as Tier) : 'today' })
    }
    openAddSheet({ tier: 'anytime' })
  }

  return (
    <div className={cn('h-full flex bg-canvas', !immersive && 'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]')}>
      <a
        href="#main-scroll"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3 focus:text-on-surface"
        onClick={(e) => {
          e.preventDefault()
          const main = mainRef.current
          const target = main?.querySelector<HTMLElement>('[data-main-start]') ?? main
          target?.focus()
        }}
      >跳到主内容</a>
      <Sidebar />
      <div className={cn('workspace-column relative flex-1 flex flex-col min-w-0', !immersive && 'md:pt-[env(safe-area-inset-top,0px)]')}>
        {showTopBar && <TopBar title={title} />}
        <main
          id="main-scroll"
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            'workspace-scroll flex-1 min-h-0',
            showTopBar && 'has-mobile-toolbar',
            !immersive && 'has-mobile-tabs',
            selfScrolling ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain',
          )}
        >
          <div className={cn('min-w-0', selfScrolling && 'h-full', revisiting && 'enter-once')}>
            <Suspense key={section} fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
        {!immersive && <BottomNav />}
      </div>

      {/* 计时中：迷你条目常驻底栏上方，切到任何页都看得到 */}
      {!immersive && <FocusMiniBar besideAddButton={section === '/tasks' || pathname === '/docs'} />}

      {/* 手机统一添加入口：右下角、底栏上方，拇指够得着；桌面用输入框与 N 快捷键 */}
      {showFab && (
        <button
          type="button"
          id="fab-add"
          onClick={onAdd}
          aria-label="添加任务"
          title="添加任务"
          className={cn(
            'mobile-actions-offset press md:hidden fixed right-[calc(.75rem+env(safe-area-inset-right))] z-30 grid place-items-center size-12 rounded-full cursor-pointer',
            'bg-primary-action text-on-primary-action shadow-md shadow-primary/20',
          )}
        >
          <Plus size={24} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
