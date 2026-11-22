import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useDndContext } from '@dnd-kit/core'
import type { Doc } from '@/db/db'

const MIN_CARD_WIDTH = 260
const GAP = 12
const OVERSCAN = 4

export function DocsGrid({ docs, showSnippets, renderCard }: {
  docs: Doc[]
  showSnippets: boolean
  renderCard: (doc: Doc) => ReactNode
}) {
  const grid = useRef<HTMLDivElement>(null)
  const { active } = useDndContext()
  const [focusedId, setFocusedId] = useState<string>()
  const [windowRows, setWindowRows] = useState({ columns: 1, start: 0, end: 16 })
  // 两行标题、标签和进度同时出现时，单列卡片也要留出上下内边距。
  const cardHeight = showSnippets ? 184 : 144
  const rowStep = cardHeight + GAP

  useLayoutEffect(() => {
    const element = grid.current!
    const scroll = element.closest<HTMLElement>('main')
    if (!scroll) return
    const measure = () => {
      const columns = Math.max(1, Math.floor((element.clientWidth + GAP) / (MIN_CARD_WIDTH + GAP)))
      const top = scroll.getBoundingClientRect().top - element.getBoundingClientRect().top
      const last = Math.ceil(docs.length / columns)
      const start = Math.min(last - 1, Math.max(0, Math.floor(top / rowStep) - OVERSCAN))
      const end = Math.min(last, Math.max(start + 1, Math.ceil((top + scroll.clientHeight) / rowStep) + OVERSCAN))
      setWindowRows((prev) => prev.columns === columns && prev.start === start && prev.end === end
        ? prev : { columns, start, end })
    }
    measure()
    scroll.addEventListener('scroll', measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    resize.observe(scroll)
    return () => {
      scroll.removeEventListener('scroll', measure)
      resize.disconnect()
    }
  }, [docs.length, rowStep])

  const { columns, start, end } = windowRows
  const rowCount = Math.ceil(docs.length / columns)
  const rows = new Set<number>()
  for (let row = Math.min(start, rowCount - 1); row < Math.min(end, rowCount); row++) rows.add(row)
  // 保留正在操作的卡片，滚动时仍可完成拖动或使用卡片菜单。
  for (const id of [focusedId, active?.id]) {
    if (id == null) continue
    const index = docs.findIndex((doc) => doc.id === id)
    if (index >= 0) rows.add(Math.floor(index / columns))
  }

  return (
    <div
      ref={grid}
      className="relative"
      style={{ height: rowCount * rowStep - GAP }}
      onFocus={(e) => setFocusedId((e.target as HTMLElement).closest<HTMLElement>('[data-draggable-doc]')?.dataset.draggableDoc)}
      onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setFocusedId(undefined) }}
    >
      {[...rows].sort((a, b) => a - b).map((row) => (
        <div key={row} className="absolute inset-x-0 grid" style={{
          top: row * rowStep,
          height: cardHeight,
          gap: GAP,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}>
          {docs.slice(row * columns, (row + 1) * columns).map(renderCard)}
        </div>
      ))}
    </div>
  )
}
