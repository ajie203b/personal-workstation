import { Outlet, useLocation, useSearchParams } from 'react-router'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { TopBar } from './TopBar'
import { NAV_ITEMS, PAGE_TITLE } from './nav'
import { useThemeEffect } from '@/shared/theme'
import { RouteProgress } from '@/shared/ui/RouteProgress'
import { FocusMiniBar, useFocusActive } from '@/shared/FocusMiniBar'
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
const SELF_SCROLLING = /^\/docs\//

/**
 * 沉浸模式：阅读器 / 编辑器 / 高亮复习自己带工具栏，全局顶栏与底栏全部让位。
 * 手机上原来顶栏 56 + 阅读器工具栏 56 + 底栏 56 ≈ 170px 被三套壳吃掉，正文只剩一条缝。
 */
const IMMERSIVE = [/^\/docs\/.+/, /^\/review$/]

export function AppShell() {
  useThemeEffect()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const openAddSheet = useUi((s) => s.openAddSheet)
  const focusActive = useFocusActive()
  const section = `/${pathname.split('/')[1] || ''}`
  const title = PAGE_TITLE[pathname] ?? PAGE_TITLE[section] ?? '个人工作站'

  // 同一会话内重复进入某视图时不再重放入场动画（P0：去掉反复切页的「晃」）
  const seen = useRef(new Set<string>())
  const revisiting = seen.current.has(section)
  const contentRef = useRef<HTMLDivElement>(null)
  const prevSection = useRef(section)

  // 底栏切页时让内容从切换方向轻轻流进来；同页刷新/深链不做
  useLayoutEffect(() => {
    const from = prevSection.current
    prevSection.current = section
    if (from === section) return
    const fromIdx = NAV_ITEMS.findIndex((item) => item.path === from)
    const toIdx = NAV_ITEMS.findIndex((item) => item.path === section)
    if (fromIdx < 0 || toIdx < 0) return
    const el = contentRef.current
    if (!el) return
    el.style.setProperty('--flow-x', `${toIdx > fromIdx ? 16 : -16}px`)
    el.classList.remove('page-flow-in')
    void el.offsetWidth
    el.classList.add('page-flow-in')
  }, [section])

  // 路由切换回顶部
  useEffect(() => {
    seen.current.add(section)
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [pathname, section])

  const selfScrolling = SELF_SCROLLING.test(pathname)
  const immersive = IMMERSIVE.some((re) => re.test(pathname))
  // 设置页 / 工具页是配置与工具页，不摆「加任务」的悬浮按钮
  const showFab = !immersive && section !== '/settings' && section !== '/tools'

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
    <div className="h-full flex bg-surface">
      <RouteProgress />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {!immersive && <TopBar title={title} />}
        <main
          id="main-scroll"
          className={cn(
            'flex-1 min-h-0',
            selfScrolling ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain',
          )}
        >
          <div ref={contentRef} className={cn('page-flow', selfScrolling && 'h-full', revisiting && 'enter-once')}>
            <Outlet />
          </div>
        </main>
        {!immersive && <BottomNav />}
      </div>

      {/* 计时中：迷你条目常驻底栏上方，切到任何页都看得到 */}
      {!immersive && <FocusMiniBar />}

      {/* 手机统一添加入口：右下角、底栏上方，拇指够得着；桌面用输入框与 N 快捷键 */}
      {showFab && (
        <button
          type="button"
          id="fab-add"
          onClick={onAdd}
          aria-label="添加任务"
          title="添加任务"
          className={cn(
            'md:hidden fixed right-4 z-30 grid place-items-center w-14 h-14 rounded-full cursor-pointer',
            'bg-primary text-on-primary shadow-lg shadow-primary/25',
            'active:scale-95 transition-[transform,bottom] duration-200',
          )}
          style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${focusActive ? '8.25rem' : '4.25rem'})` }}
        >
          <Plus size={26} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}
