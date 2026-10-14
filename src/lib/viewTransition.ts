import { flushSync } from 'react-dom'

/**
 * 共享元素转场（View Transitions API）：让「列表卡片 → 详情」在空间上连续生长，
 * 而不是各播各的淡入——这是最接近 macOS 观感的一步。
 *
 * 约定只用一个转场名 MORPH_NAME：旧状态里给它的是列表卡片，新状态里给它的是详情容器，
 * 浏览器会自动在两者的位置/尺寸/圆角之间插值，形成「同一元素长过去」的连续感。
 *
 * 稳健降级：
 * - 浏览器不支持 / 系统开启「减弱动态效果」→ 直接同步执行，不做转场；
 * - 已有转场进行中（切太快）会抛错 → 捕获后同步执行，绝不吞掉本次交互。
 *
 * 关键时序：转场名必须在调用 startViewTransition 之前挂到「来源元素」上，
 * 这样它才会进入旧快照；而在回调（新快照前）里把它摘掉并让目标元素带名，
 * 就避免了「同名元素同时存在」导致的转场失效。
 */

export const MORPH_NAME = 'vt-morph-card'

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> }
}

export function supportsViewTransition(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as DocWithVT).startViewTransition === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// 让「详情侧」知道本次打开是经由卡片形变而来（据此抑制自身入场动画，避免与转场打架）
let pendingMorph = false
export function markMorph() {
  pendingMorph = true
}
export function consumeMorph(): boolean {
  const v = pendingMorph
  pendingMorph = false
  return v
}

const clearName = (el: Element | null) => {
  if (el instanceof HTMLElement) el.style.viewTransitionName = ''
}

/**
 * 打开：来源元素（列表卡片）在旧快照带名 → 回调里摘名并执行 change（打开详情）。
 * @param getSource 返回列表卡片元素（如 document.getElementById(`task-${id}`)）
 * @param change    真正改变 UI 的同步回调（如 () => openDetail(id) 或 navigate(...)）
 */
export function morphOpen(getSource: () => HTMLElement | null, change: () => void): void {
  const doc = document as DocWithVT
  const source = getSource()
  if (!supportsViewTransition() || !doc.startViewTransition || !source) {
    markMorph()
    change()
    return
  }
  markMorph()
  source.style.viewTransitionName = MORPH_NAME
  try {
    const t = doc.startViewTransition(() => {
      flushSync(change)
      clearName(source) // 新快照里来源不再带名，改由详情容器带名
    })
    void t.finished.finally(() => clearName(source))
  } catch {
    clearName(source)
    change()
  }
}

/**
 * 关闭：详情容器（旧快照带名）→ 回调里关闭并给列表卡片补名。
 * @param getTarget 返回要「长回去」的列表卡片元素
 * @param change    真正关闭详情的同步回调（如 () => openDetail(null) / navigate(-1)）
 */
export function morphClose(getTarget: () => HTMLElement | null, change: () => void): void {
  const doc = document as DocWithVT
  if (!supportsViewTransition() || !doc.startViewTransition) {
    change()
    return
  }
  try {
    const t = doc.startViewTransition(() => {
      flushSync(change)
      const target = getTarget()
      if (target) target.style.viewTransitionName = MORPH_NAME
    })
    void t.finished.finally(() => clearName(getTarget()))
  } catch {
    change()
  }
}
