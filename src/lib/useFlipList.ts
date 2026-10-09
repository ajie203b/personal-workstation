import { useLayoutEffect, useRef } from 'react'

/**
 * FLIP 补位（动效方案 5.C）：列表增删/换序后，留下的节点从旧位置滑到新位置，
 * 而不是瞬跳。标准 First-Last-Invert-Play。
 *
 * 触发时机是关键：完成/删除的那一帧，store 已经变了但 IndexedDB 的 liveQuery
 * 还没推来新快照，DOM 仍是旧的——所以旧坐标必须从「上一次拿到的数据派生」里取，
 * 而不是在渲染后量 DOM。
 *
 * 只动 transform；拖拽中的节点由 dnd-kit 负责，这里跳过。
 */
export function useFlipList<T extends HTMLElement>(
  containerRef: React.RefObject<T>,
  items: readonly { id: string }[],
) {
  const prevIds = useRef<string[]>([])
  const rects = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const root = containerRef.current
    if (!root) return
    const readRects = () => {
      const m = new Map<string, DOMRect>()
      root.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((el) => m.set(el.dataset.flipId!, el.getBoundingClientRect()))
      return m
    }
    const ids = items.map((i) => i.id)
    const changed = ids.length !== prevIds.current.length || ids.some((id, i) => id !== prevIds.current[i])

    if (!changed) {
      // 数据未变：刷新坐标即可（滚动会让位置移动，不刷新会拿旧坐标算出假位移）
      rects.current = readRects()
      return
    }
    prevIds.current = ids
    const before = rects.current
    const next = readRects()
    const moving: { el: HTMLElement; dx: number; dy: number }[] = []

    next.forEach((rect, id) => {
      const old = before.get(id)
      if (!old) return
      const dx = old.left - rect.left
      const dy = old.top - rect.top
      const el = root.querySelector<HTMLElement>(`[data-flip-id="${id}"]`)
      if (!el || el.dataset.dragging === 'true') return
      if (dx || dy) moving.push({ el, dx, dy })
    })
    rects.current = next

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const { el, dx, dy } of moving) {
      // 关键：Web Animations 会覆盖内联 style，动画结束后必须 cancel 释放，
      // 否则同一元素上其它 transform（如按压 :active、拖拽位移）会永久失效
      const a = el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 260, easing: 'cubic-bezier(.2, 0, 0, 1)' },
      )
      a.finished.then(() => a.cancel()).catch(() => {})
    }
  }, [items])
}
