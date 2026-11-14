/**
 * 编辑器未保存离开守卫。
 * 当活动编辑器注册了脏状态检查时，同时拦截：
 * 1) 显式调用 guardNavigation(proceed) 的编程式导航（返回按钮、命令面板、侧栏动作按钮）；
 * 2) 文档内带 `#/` 的 React Router `<Link>`/`<NavLink>` 左键点击。
 */
export type UnsavedGuard = (proceed: () => void) => boolean

let activeGuard: UnsavedGuard | null = null
let detachClickListener: (() => void) | null = null

function ensureClickInterceptor(navigate: (path: string) => void) {
  if (detachClickListener || typeof document === 'undefined') return
  const onClick = (e: MouseEvent) => {
    if (!activeGuard) return
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const target = e.target as Element | null
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    if (anchor.hasAttribute('download')) return
    const targetAttr = anchor.getAttribute('target')
    if (targetAttr && targetAttr !== '_self') return
    const href = anchor.getAttribute('href') ?? ''
    if (!href.startsWith('#/')) return
    if (href === window.location.hash) return
    const proceed = () => {
      navigate(href.slice(1))
    }
    if (activeGuard(proceed)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  document.addEventListener('click', onClick, true)
  detachClickListener = () => {
    document.removeEventListener('click', onClick, true)
    detachClickListener = null
  }
}

export function registerUnsavedGuard(guard: UnsavedGuard, navigate: (path: string) => void): () => void {
  activeGuard = guard
  detachClickListener?.()
  ensureClickInterceptor(navigate)
  return () => {
    if (activeGuard === guard) {
      activeGuard = null
      detachClickListener?.()
    }
  }
}

export function guardNavigation(proceed: () => void): void {
  if (activeGuard?.(proceed)) return
  proceed()
}
