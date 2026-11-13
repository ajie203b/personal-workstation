import { useEffect, useRef } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export function EditorFindReplaceBar({
  open,
  focusTick,
  showReplace,
  onToggleReplace,
  query,
  replaceText,
  caseSensitive,
  active,
  total,
  onQueryChange,
  onReplaceTextChange,
  onToggleCase,
  onNext,
  onPrev,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
}: {
  open: boolean
  focusTick: number
  showReplace: boolean
  onToggleReplace: () => void
  query: string
  replaceText: string
  caseSensitive: boolean
  active: number
  total: number
  onQueryChange: (q: string) => void
  onReplaceTextChange: (val: string) => void
  onToggleCase: () => void
  onNext: () => void
  onPrev: () => void
  onReplaceCurrent: () => void
  onReplaceAll: () => void
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

  const countLabel = !query
    ? '输入查找'
    : total === 0
      ? '0/0'
      : `${active + 1}/${total}`

  return (
    <div
      role="search"
      aria-label="编辑器查找与替换"
      className="shrink-0 flex flex-col gap-1.5 px-3 md:px-5 py-2 border-b border-outline/70 bg-surface-2/90 backdrop-blur"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={onToggleReplace}
          aria-label={showReplace ? '收起替换栏' : '展开替换栏'}
          title={showReplace ? '收起替换' : '展开替换 (Ctrl+H)'}
          className={cn(
            'grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:bg-surface-3 cursor-pointer transition-colors',
            showReplace && 'bg-primary-soft text-primary',
          )}
        >
          <Replace size={14} />
        </button>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) onPrev()
                else onNext()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="查找文本…"
            aria-label="查找文本"
            className="w-full h-8 pl-8 pr-2.5 rounded-[8px] bg-surface border border-outline text-[12.5px] outline-none focus:border-primary/60"
          />
        </div>
        <button
          type="button"
          onClick={onToggleCase}
          aria-label="区分大小写"
          title="区分大小写"
          aria-pressed={caseSensitive}
          className={cn(
            'grid place-items-center w-7 h-7 rounded-[7px] border border-outline cursor-pointer transition-colors',
            caseSensitive ? 'bg-primary-soft border-primary/40 text-primary' : 'bg-surface text-on-surface-2 hover:text-on-surface',
          )}
        >
          <CaseSensitive size={14} />
        </button>
        <span className="text-[11.5px] text-on-surface-2 tabular-nums px-1 min-w-[44px] text-center">{countLabel}</span>
        <button
          type="button"
          aria-label="上一处"
          disabled={total === 0}
          onClick={onPrev}
          className="grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:bg-surface-3 disabled:opacity-40 cursor-pointer"
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          aria-label="下一处"
          disabled={total === 0}
          onClick={onNext}
          className="grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:bg-surface-3 disabled:opacity-40 cursor-pointer"
        >
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          aria-label="关闭查找替换"
          onClick={onClose}
          className="ml-auto grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1.5 flex-wrap pl-8">
          <input
            type="text"
            value={replaceText}
            onChange={(e) => onReplaceTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onReplaceCurrent()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="替换为…"
            aria-label="替换为"
            className="flex-1 min-w-[160px] max-w-xs h-8 px-2.5 rounded-[8px] bg-surface border border-outline text-[12.5px] outline-none focus:border-primary/60"
          />
          <button
            type="button"
            disabled={total === 0}
            onClick={onReplaceCurrent}
            className="h-8 px-2.5 rounded-[8px] border border-outline bg-surface text-[12px] text-on-surface hover:bg-surface-3 disabled:opacity-40 cursor-pointer"
          >
            替换
          </button>
          <button
            type="button"
            disabled={total === 0}
            onClick={onReplaceAll}
            className="h-8 px-2.5 rounded-[8px] bg-primary text-on-primary text-[12px] font-medium hover:opacity-95 disabled:opacity-40 cursor-pointer"
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  )
}
