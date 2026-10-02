import { useEffect } from 'react'
import { useUi, type Theme } from '@/stores/ui'

const media = window.matchMedia('(prefers-color-scheme: dark)')

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && media.matches)
  document.documentElement.classList.toggle('dark', dark)
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
