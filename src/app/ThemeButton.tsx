import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useUi, type ThemeMode } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { setThemeWithTransition } from '@/shared/theme'
import { haptic } from '@/lib/haptics'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuLabel } from '@/shared/ui/Menu'

const META: Record<ThemeMode, { icon: typeof Sun; label: string }> = {
  system: { icon: Monitor, label: '跟随系统' },
  light: { icon: Sun, label: '浅色' },
  dark: { icon: Moon, label: '深色' },
}
const MODES: ThemeMode[] = ['system', 'light', 'dark']

/** 侧栏主题入口：三档菜单，跟设置页「跟随系统 / 浅色 / 深色」保持一致 */
export function ThemeButton({ compact = false }: { compact?: boolean }) {
  const mode = useUi((s) => s.themeMode)
  const setThemeMode = useUi((s) => s.setThemeMode)
  const { icon: Icon, label } = META[mode]

  const choose = (next: ThemeMode) => {
    if (next === mode) return
    haptic('light')
    if (next === 'system') setThemeMode('system')
    else setThemeWithTransition(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`主题：${label}`}
          title={`主题：${label}`}
          className={cn(
            'press relative overflow-hidden flex items-center gap-2 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer',
            compact ? 'w-10 justify-center max-lg:px-0' : 'w-full px-2.5 text-[13px]',
          )}
        >
          <Icon size={18} strokeWidth={1.9} />
          {!compact && <span className="hidden lg:block">{label}</span>}
        </button>
      </DropdownMenuTrigger>
      <MenuContent>
        <MenuLabel>主题</MenuLabel>
        {MODES.map((m) => {
          const M = META[m]
          return (
            <MenuItem key={m} active={mode === m} onSelect={() => choose(m)}>
              <M.icon size={15} />
              <span className="flex-1">{M.label}</span>
              {mode === m && <Check size={14} />}
            </MenuItem>
          )
        })}
      </MenuContent>
    </DropdownMenu>
  )
}
