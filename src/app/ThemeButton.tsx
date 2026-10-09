import { Moon, Sun, SunMoon } from 'lucide-react'
import { useUi, type Theme } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { setThemeWithTransition } from '@/shared/theme'
import { haptic } from '@/lib/haptics'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const ICONS: Record<Theme, typeof Sun> = { system: SunMoon, light: Sun, dark: Moon }
const LABELS: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

/** 从按钮位置记下扩散原点，CSS 的 ::view-transition-new(root) 用它画圆（多处共用） */
export function markOrigin(e: React.MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${rect.left + rect.width / 2}px`)
  root.style.setProperty('--vt-y', `${rect.top + rect.height / 2}px`)
}

export function ThemeButton({ compact = false }: { compact?: boolean }) {
  const theme = useUi((s) => s.theme)
  const Icon = ICONS[theme]
  return (
    <button
      type="button"
      aria-label={`主题：${LABELS[theme]}（点击切换到${LABELS[NEXT[theme]]}）`}
      title={`主题：${LABELS[theme]}`}
      onClick={(e) => {
        markOrigin(e)
        haptic('light')
        setThemeWithTransition(NEXT[theme])
      }}
      className={cn(
        'press relative overflow-hidden flex items-center gap-2 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer',
        compact ? 'w-10 justify-center max-lg:px-0' : 'w-full px-2.5 text-[13px]',
      )}
    >
      <Icon size={18} strokeWidth={1.9} />
      {!compact && <span className="hidden lg:block">{LABELS[theme]}</span>}
    </button>
  )
}

/** 手机顶栏上的主题切换（含当前模式指示） */
export function ThemeButtonInline() {
  const theme = useUi((s) => s.theme)
  const Icon = ICONS[theme]
  return (
    <button
      type="button"
      aria-label={`主题：${LABELS[theme]}（点击切换到${LABELS[NEXT[theme]]}）`}
      onClick={(e) => {
        markOrigin(e)
        haptic('light')
        setThemeWithTransition(NEXT[theme])
      }}
      className="press relative overflow-hidden grid place-items-center w-10 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
    >
      <Icon size={19} strokeWidth={1.9} />
    </button>
  )
}
