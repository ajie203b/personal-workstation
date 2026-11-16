import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { IconSettings } from '@/shared/icons'
import { BrandMark } from '@/shared/BrandMark'
import { ChevronLeft } from 'lucide-react'
import { getSettingsSection, SETTINGS_TITLES } from './nav'

/**
 * 手机端顶栏（<md 显示）：玻璃材质 + 品牌图标（回今日）+ 页面标题 + 设置齿轮。
 *
 * v2.1 调整：主题切换收进设置页（顶栏只留一个齿轮），设置入口不再藏在应用图标上；
 * 图标从「点一下进设置」改成「回今日」—— 应用图标回首页才是通用预期。
 */
export function TopBar({ title }: { title: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const toolPage = pathname.startsWith('/tools/')
  const settingsSection = pathname === '/settings' ? getSettingsSection(params.get('section')) : null
  const backTarget = toolPage ? '/tools' : settingsSection ? '/settings' : null

  return (
    <header
      className="mobile-toolbar glass md:hidden absolute inset-x-0 top-0 z-30 grid items-center gap-2 px-3"
    >
      {backTarget ? (
        <button type="button" aria-label={toolPage ? '返回工具' : '返回设置'} onClick={() => navigate(backTarget)}
          className="chrome-button press grid size-11 shrink-0 place-items-center rounded-full text-primary">
          <ChevronLeft size={22} aria-hidden />
        </button>
      ) : <button
        aria-label="回到今日"
        title="今日"
        onClick={() => navigate('/today')}
        className="chrome-button press shrink-0 cursor-pointer rounded-full select-none"
      >
        <BrandMark />
      </button>}
      {backTarget
        ? <h1 className="min-w-0 truncate text-center text-[16px] font-semibold">{settingsSection ? SETTINGS_TITLES[settingsSection] : title}</h1>
        : <span className="min-w-0 truncate text-center text-[16px] font-semibold">{title}</span>}
      {pathname !== '/settings' && (
        <button
          type="button"
          aria-label="设置"
          title="设置"
          onClick={() => navigate('/settings')}
          className="chrome-button press grid place-items-center size-11 rounded-full text-on-surface-2"
        >
          <IconSettings size={19} />
        </button>
      )}
    </header>
  )
}
