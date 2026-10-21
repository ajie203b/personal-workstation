/**
 * 动效工具：从 CSS 令牌读取时长/缓动，避免在 JS 里散落魔法数字。
 * 令牌集中在 src/styles/index.css 的 :root，改一处即全站生效。
 */

/** 读取 CSS 时长令牌并换算为毫秒（兼容 "0.15s" 与 "150ms" 两种写法） */
export function durMs(name: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return raw.endsWith('ms') ? n : n * 1000
}

/** 系统偏好与应用开关共用同一判断，CSS 与 JS 动效同步停用。 */
export function prefersReducedMotion(): boolean {
  return (
    (typeof document !== 'undefined' && document.documentElement.classList.contains('no-motion')) ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  )
}
