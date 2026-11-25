import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { IconSettings } from '@/shared/icons'
import { BrandMark } from '@/shared/BrandMark'
import { ChevronLeft, Search } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { getSettingsSection, SETTINGS_TITLES } from './nav'

/**
 * 手机端顶栏（<md 显示）：玻璃材质 + 品牌图标（回今日）+ 页面标题 + 全局搜索与设置入口。
 */
export function TopBar({ title }: { title: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const toolPage = pathname.startsWith('/tools/')
  const settingsSection = pathname === '/settings' ? getSettingsSection(params.get('section')) : null
  const backTarget = toolPage ? '/tools' : settingsSection ? '/settings' : null

  return (
    <header
      className="mobile-toolbar md:hidden absolute inset-x-0 top-0 z-30 grid items-center gap-2 px-3"
    >
      {backTarget ? (
        <button type="button" aria-label={toolPage ? '返回工具' : '返回设置'} onClick={() => navigate(backTarget)}
          className="chrome-button press grid size-9 shrink-0 justify-self-start place-items-center rounded-full text-primary">
          <ChevronLeft size={21} strokeWidth={2.2} aria-hidden />
        </button>
      ) : <button
        type="button"
        aria-label="回到今日"
        title="今日"
        onClick={() => navigate('/today')}
        className="chrome-button press grid size-9 shrink-0 justify-self-start place-items-center cursor-pointer rounded-full select-none"
      >
        <span className="inline-flex scale-[0.9]"><BrandMark /></span>
      </button>}
      {backTarget
        ? <h1 className="min-w-0 max-w-[56vw] truncate text-center text-[15.5px] font-semibold tracking-[-0.015em]">{settingsSection ? SETTINGS_TITLES[settingsSection] : title}</h1>
        : <span className="min-w-0 max-w-[56vw] truncate text-center text-[15.5px] font-semibold tracking-[-0.015em]">{title}</span>}
      <div className="flex items-center justify-self-end gap-0.5">
        <button
          type="button"
          aria-label="搜索与快速跳转"
          title="搜索"
          onClick={() => setPaletteOpen(true)}
          className="chrome-button press grid place-items-center size-9 rounded-full text-on-surface-2 cursor-pointer"
        >
          <Search size={17.5} strokeWidth={1.9} />
        </button>
        {pathname !== '/settings' && (
          <button
            type="button"
            aria-label="设置"
            title="设置"
            onClick={() => navigate('/settings')}
            className="chrome-button press grid place-items-center size-9 rounded-full text-on-surface-2 cursor-pointer"
          >
            <IconSettings size={18} />
          </button>
        )}
      </div>
    </header>
  )
}
