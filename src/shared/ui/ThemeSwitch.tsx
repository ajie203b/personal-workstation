import { Monitor, Moon, Sun } from 'lucide-react'
import { useUi, type Theme } from '@/stores/ui'
import { markOrigin } from '@/app/ThemeButton'
import { setThemeWithTransition } from '@/shared/theme'
import { haptic } from '@/lib/haptics'

/**
 * 三态主题开关（拟物）。质感取自 Uiverse 的 bright-dolphin-91（Yaya12085，MIT）：
 * 内阴影凹槽轨道 + 金属渐变旋钮 + hover 轻微 3D 倾斜。原组件是二态 checkbox，
 * 这里按本站的浅色 / 深色 / 跟随系统三档重做成一个滑块，颜色全部走设计令牌，深浅主题都成立。
 */
const ORDER: Theme[] = ['light', 'dark', 'system']
const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: '浅色' },
  dark: { icon: Moon, label: '深色' },
  system: { icon: Monitor, label: '跟随系统' },
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
            <Icon size={18} strokeWidth={1.9} />
          </button>
        )
      })}
    </div>
  )
}
