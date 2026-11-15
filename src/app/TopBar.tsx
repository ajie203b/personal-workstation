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
      className="glass md:hidden sticky top-0 z-30 flex items-center gap-2.5 px-3 border-b border-outline/70"
      style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 'calc(3.5rem + env(safe-area-inset-top))' }}
    >
      {backTarget ? (
        <button type="button" aria-label={toolPage ? '返回工具' : '返回设置'} onClick={() => navigate(backTarget)}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-primary active:bg-primary-soft">
          <ChevronLeft size={22} aria-hidden />
        </button>
      ) : <button
        aria-label="回到今日"
        title="今日"
        onClick={() => navigate('/today')}
        className="shrink-0 cursor-pointer rounded-[10px] active:opacity-80 select-none"
      >
        <BrandMark />
      </button>}
      {backTarget
        ? <h1 className="text-[15px] font-semibold">{settingsSection ? SETTINGS_TITLES[settingsSection] : title}</h1>
        : <span className="text-[15px] font-semibold">{title}</span>}
      <button
        type="button"
        aria-label="设置"
        title="设置"
        onClick={() => navigate(pathname.startsWith('/settings') ? '/today' : '/settings')}
        className={
          pathname.startsWith('/settings')
            ? 'ml-auto grid place-items-center size-11 rounded-[10px] bg-primary-soft text-primary shrink-0'
            : 'ml-auto grid place-items-center size-11 rounded-[10px] text-on-surface-2 active:bg-surface-3 shrink-0'
        }
      >
        <IconSettings size={19} />
      </button>
    </header>
  )
}
