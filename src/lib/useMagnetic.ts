import { useEffect, type RefObject } from 'react'
import { prefersReducedMotion } from './motion'

const REACH = 80
const MAX_PULL = 14
const FOLLOW = 0.15

/**
 * 磁吸按钮（ui-motion「磁吸按钮」）：鼠标靠近 80px 内，按钮朝指针方向偏移，
 * 最多 14px；每帧追赶剩余距离的 15%，移开后平滑回弹。
 * 只在有精细指针的桌面/网页生效，触屏保持原生按压。
 */
export function useMagnetic<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (prefersReducedMotion()) return

    let raf = 0
    let curX = 0
    let curY = 0
    let targetX = 0
    let targetY = 0
    let scale = 1
    let targetScale = 1
    let hovering = false

    const label = () => el.querySelector<HTMLElement>('[data-magnetic-label]')

    const apply = () => {
      el.style.transform = `translate3d(${curX.toFixed(2)}px, ${curY.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`
      const text = label()
      if (text) {
        // 文字比按钮多偏一点（约 1.6 倍），小按钮上封顶 18px 防止溢出
        const tx = Math.max(-18, Math.min(18, curX * 1.6))
        const ty = Math.max(-18, Math.min(18, curY * 1.6))
        text.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`
      }
    }

    const tick = () => {
      curX += (targetX - curX) * FOLLOW
      curY += (targetY - curY) * FOLLOW
      scale += (targetScale - scale) * 0.22
      const settled =
        Math.abs(targetX - curX) < 0.05 &&
        Math.abs(targetY - curY) < 0.05 &&
        Math.abs(targetScale - scale) < 0.002
      if (!settled) {
        apply()
        raf = requestAnimationFrame(tick)
        return
      }
      raf = 0
      if (!hovering && targetX === 0 && targetY === 0) {
        el.style.transform = ''
        const text = label()
        if (text) text.style.transform = ''
      }
    }

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const nearestX = Math.min(Math.max(e.clientX, r.left), r.right)
      const nearestY = Math.min(Math.max(e.clientY, r.top), r.bottom)
      const distance = Math.hypot(e.clientX - nearestX, e.clientY - nearestY)
      if (distance > REACH) {
        hovering = false
        targetX = 0
        targetY = 0
        kick()
        return
      }
      hovering = true
      const pull = 1 - distance / REACH
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const len = Math.hypot(e.clientX - cx, e.clientY - cy) || 1
      // 全宽按钮位移太大会露出旁边空隙，收敛到 7px
      const limit = el.offsetWidth > 320 ? MAX_PULL / 2 : MAX_PULL
      targetX = ((e.clientX - cx) / len) * limit * pull
      targetY = ((e.clientY - cy) / len) * limit * pull
      // 背景提亮从指针进入的方向铺开
      el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
      el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
      kick()
    }

    const onDown = () => {
      targetScale = 0.96
      kick()
    }
    const onUp = () => {
      targetScale = 1
      kick()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.style.transform = ''
      const text = label()
      if (text) text.style.transform = ''
    }
  }, [ref, enabled])
}
