import { Moon, Sun, SunMoon } from 'lucide-react'
import { useUi, type Theme } from '@/stores/ui'
import { cn } from '@/lib/cn'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const ICONS: Record<Theme, typeof Sun> = { system: SunMoon, light: Sun, dark: Moon }
const LABELS: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

export function ThemeButton({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useUi()
  const Icon = ICONS[theme]
  return (
    <button
      type="button"
      aria-label={`主题：${LABELS[theme]}（点击切换到${LABELS[NEXT[theme]]}）`}
      title={`主题：${LABELS[theme]}`}
      onClick={() => setTheme(NEXT[theme])}
      className={cn(
        'flex items-center gap-2 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer',
        compact ? 'w-10 justify-center max-lg:px-0' : 'w-full px-2.5 text-[13.5px]',
      )}
    >
      <Icon size={18} strokeWidth={1.9} />
      {!compact && <span className="hidden lg:block">{LABELS[theme]}</span>}
    </button>
  )
}

/** 手机顶栏上的主题切换（含当前模式指示） */
export function ThemeButtonInline() {
  const { theme, setTheme } = useUi()
  const Icon = ICONS[theme]
  return (
    <button
      type="button"
      aria-label={`主题：${LABELS[theme]}`}
      onClick={() => setTheme(NEXT[theme])}
      className="grid place-items-center w-10 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
    >
      <Icon size={19} strokeWidth={1.9} />
    </button>
  )
}
