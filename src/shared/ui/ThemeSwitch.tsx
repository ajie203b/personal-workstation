import { Moon, Sun } from 'lucide-react'
import { useUi, type Theme } from '@/stores/ui'
import { markOrigin } from '@/app/ThemeButton'
import { setThemeWithTransition } from '@/shared/theme'
import { haptic } from '@/lib/haptics'

/**
 * 扁平主题开关（macOS 式）：分段控件 + 滑块跟随，取消拟物金属/3D 倾斜。
 * 只保留 浅色 / 深色 两档（跟随系统在设置页外观分区单独选）。
 */
const ORDER: Theme[] = ['light', 'dark']
const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: '浅色' },
  dark: { icon: Moon, label: '深色' },
}

export function ThemeSwitch() {
  const theme = useUi((s) => s.theme)
  const pos = Math.max(0, ORDER.indexOf(theme))

  return (
    <div className="theme-switch" role="radiogroup" aria-label="主题模式">
      <span className="theme-switch-knob" data-pos={pos} aria-hidden />
      {ORDER.map((v, i) => {
        const Icon = META[v].icon
        const active = v === theme
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={META[v].label}
            title={META[v].label}
            data-pos={i}
            className="theme-switch-slot"
            onClick={(e) => {
              if (active) return
              markOrigin(e)
              haptic('light')
              setThemeWithTransition(v)
            }}
          >
            <Icon size={15} strokeWidth={2} />
            <span>{META[v].label}</span>
          </button>
        )
      })}
    </div>
  )
}
