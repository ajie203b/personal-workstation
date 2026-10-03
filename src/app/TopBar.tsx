import { useNavigate } from 'react-router'
import { ThemeButtonInline } from './ThemeButton'

/** 手机端顶栏（<md 显示）：玻璃材质 + 品牌图标（点击进设置）+ 页面标题 + 主题切换 */
export function TopBar({ title }: { title: string }) {
  const navigate = useNavigate()
  return (
    <header
      className="glass md:hidden sticky top-0 z-20 flex items-center gap-2.5 px-3 border-b border-outline/70"
      style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 'calc(3.5rem + env(safe-area-inset-top))' }}
    >
      <button
        aria-label="进入设置"
        title="设置"
        onClick={() => navigate('/settings')}
        className="shrink-0 cursor-pointer rounded-[11px] active:opacity-80"
      >
        <img src="./brand.png" alt="" className="w-10 h-10 rounded-[11px] object-cover" />
      </button>
      <span className="text-[15px] font-semibold">{title}</span>
      <div className="ml-auto">
        <ThemeButtonInline />
      </div>
    </header>
  )
}
