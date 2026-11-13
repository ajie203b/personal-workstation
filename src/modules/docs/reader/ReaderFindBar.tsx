import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export function ReaderFindBar({
  open,
  focusTick,
  query,
  active,
  total,
  searching,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: {
  open: boolean
  focusTick: number
  query: string
  active: number
  total: number
  searching?: boolean
  onQueryChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [open, focusTick])

  if (!open) return null
  const hasQuery = query.trim().length > 0
  const noHits = hasQuery && !searching && total === 0

  return (
    <div
      role="search"
      aria-label="页内查找"
      className="shrink-0 z-20 flex items-center gap-1.5 px-3 md:px-4 h-11 bg-surface-2/95 border-b border-outline/70 backdrop-blur"
    >
      <Search size={15} className="text-on-surface-2 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' || e.key === 'F3') {
            e.preventDefault()
            if (total > 0) {
              if (e.shiftKey) onPrev()
              else onNext()
            }
          }
        }}
        placeholder="页内查找…（Enter 下一处，Esc 关闭）"
        aria-label="页内查找关键词"
        className="flex-1 min-w-0 max-w-sm h-8 px-2 rounded-[8px] bg-surface border border-outline/80 text-[13px] outline-none focus:border-primary/60"
      />
      {hasQuery && (
        <span
          aria-live="polite"
          className={cn(
            'text-[11.5px] tabular-nums px-1.5 shrink-0',
            noHits ? 'text-danger' : 'text-on-surface-2',
          )}
        >
          {searching ? '搜索中…' : total > 0 ? `${active + 1} / ${total}` : '无匹配'}
        </span>
      )}
      <div className="flex items-center gap-0.5 shrink-0 ml-auto sm:ml-0">
        <button
          type="button"
          aria-label="上一处"
          title="上一处 (Shift+Enter)"
          disabled={total === 0}
          onClick={onPrev}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          aria-label="下一处"
          title="下一处 (Enter)"
          disabled={total === 0}
          onClick={onNext}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
        >
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          aria-label="关闭查找"
          title="关闭 (Esc)"
          onClick={onClose}
          className="grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
