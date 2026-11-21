import { useEffect } from 'react'
import { prefersReducedMotion } from './motion'

const SPOTLIGHT_SELECTOR = '.card, .tool-bento-card, .ranking-panel'

/**
 * 全局轻量指针聚光灯：仅在桌面精细指针且开启应用动效时生效。
 * 单一 passive 监听 + rAF 合并，直接写 CSS 变量 --sx / --sy，零 React 重渲染。
 */
export function useSpotlightEffect() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let activeEl: HTMLElement | null = null
    let pendingX = 0
    let pendingY = 0
    let raf = 0

    const flush = () => {
      raf = 0
      const el = activeEl
      if (!el || !el.isConnected) return
      const rect = el.getBoundingClientRect()
      el.style.setProperty('--sx', `${pendingX - rect.left}px`)
      el.style.setProperty('--sy', `${pendingY - rect.top}px`)
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || prefersReducedMotion()) return
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(SPOTLIGHT_SELECTOR) ?? null
      if (activeEl && activeEl !== target) {
        activeEl.removeAttribute('data-lit')
      }
      activeEl = target
      if (!target) return
      target.setAttribute('data-lit', '1')
      pendingX = event.clientX
      pendingY = event.clientY
      if (!raf) raf = window.requestAnimationFrame(flush)
    }

    const onLeave = () => {
      if (activeEl) {
        activeEl.removeAttribute('data-lit')
        activeEl = null
      }
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      onLeave()
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])
}
