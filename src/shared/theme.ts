import { useEffect } from 'react'
import { useUi, type Theme } from '@/stores/ui'

/** 主题三档：跟随系统 / 固定浅色 / 固定深色（system 档实时监听系统切换） */
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

function resolveTheme(): 'light' | 'dark' {
  const mode = useUi.getState().themeMode
  return mode === 'system' ? (systemDark() ? 'dark' : 'light') : mode
}

function apply() {
  const { accent, density, motion } = useUi.getState()
  const resolved = resolveTheme()
  const dark = resolved === 'dark'
  // 同步派生 theme：让侧栏主题按钮等只读场景在「跟随系统」档也显示正确状态
  if (useUi.getState().theme !== resolved) useUi.setState({ theme: resolved })
  const root = document.documentElement
  root.classList.add('theme-transition')
  root.classList.toggle('dark', dark)
  root.dataset.accent = accent
  root.dataset.density = density
  root.classList.toggle('no-motion', !motion)
  setTimeout(() => root.classList.remove('theme-transition'), 300)
  // 同步 meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (meta) meta.setAttribute('content', dark ? '#1F1E21' : '#FFFFFF')
}

/**
 * 主题切换：可用时走 View Transitions 的交叉淡入（macOS 气质，不再圆形扩散），
 * 不支持 / 减弱动效时保持原来的全站过渡，功能完全一致。
 */
export function setThemeWithTransition(next: Theme) {
  const doc = document.documentElement as HTMLElement & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> }
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !useUi.getState().motion
  if (!doc.startViewTransition || reduced) {
    useUi.getState().setTheme(next)
    return
  }
  try {
    doc.startViewTransition(() => useUi.getState().setTheme(next)).finished
      .catch(() => { /* 转场被打断不影响状态已生效 */ })
  } catch {
    // 页面已有进行中的转场时 startViewTransition 会抛错：直接同步落状态，别吞掉切换
    useUi.getState().setTheme(next)
  }
}

/** 应用主题 + 强调色 + 密度 + 动效开关；system 档监听系统外观变化 */
export function useThemeEffect() {
  const themeMode = useUi((s) => s.themeMode)
  const accent = useUi((s) => s.accent)
  const density = useUi((s) => s.density)
  const motion = useUi((s) => s.motion)
  useEffect(() => {
    apply()
    if (themeMode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeMode, accent, density, motion])
}
