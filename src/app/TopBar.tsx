import { ThemeButtonInline } from './ThemeButton'

/** 手机端顶栏（<md 显示）：玻璃材质 + 页面标题 + 主题切换 */
export function TopBar({ title }: { title: string }) {
  return (
    <header className="glass md:hidden sticky top-0 z-20 flex items-center h-14 px-3 border-b border-outline/70">
      <div className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary text-on-primary text-[14px] font-bold">
        工
      </div>
      <span className="ml-2.5 text-[15px] font-semibold">{title}</span>
      <div className="ml-auto">
        <ThemeButtonInline />
      </div>
    </header>
  )
}
