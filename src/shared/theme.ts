import { useEffect } from 'react'
import { useUi, type Theme } from '@/stores/ui'

const media = window.matchMedia('(prefers-color-scheme: dark)')

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && media.matches)
  document.documentElement.classList.add('theme-transition')
  document.documentElement.classList.toggle('dark', dark)
  setTimeout(() => document.documentElement.classList.remove('theme-transition'), 300)
  // 同步 meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (meta) meta.setAttribute('content', dark ? '#1E1F24' : '#FFFFFF')
}

/**
 * 主题切换：可用时走 View Transitions 的圆形扩散（从按钮位置扩出来），
 * 不支持 / 减弱动效时保持原来的全站过渡，功能完全一致。
 * origin 由调用方通过 --vt-x/--vt-y 传入（见 ThemeButton）。
 */
export function setThemeWithTransition(next: Theme) {
  const doc = document.documentElement as HTMLElement & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> }
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
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

/** 主题应用：跟随系统时监听系统切换 */
export function useThemeEffect() {
  const theme = useUi((s) => s.theme)
  useEffect(() => {
    apply(theme)
    if (theme !== 'system') return
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])
}
