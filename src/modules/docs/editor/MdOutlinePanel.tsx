import { useMemo } from 'react'
import { ListTree, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { parseMdBlocks } from '../MdReader'

export function MdOutlinePanel({
  markdown,
  onSelectHeading,
  onClose,
}: {
  markdown: string
  onSelectHeading: (headingIndex: number, text: string) => void
  onClose?: () => void
}) {
  const headings = useMemo(() => parseMdBlocks(markdown).headings, [markdown])

  return (
    <aside
      aria-label="文档大纲"
      className="w-56 shrink-0 border-r border-outline/70 bg-surface-2/40 flex flex-col min-h-0"
    >
      <div className="shrink-0 flex items-center gap-1.5 h-10 px-3 border-b border-outline/60">
        <ListTree size={14} className="text-on-surface-2 shrink-0" />
        <span className="text-[12px] font-medium text-on-surface flex-1 truncate">实时大纲</span>
        <span className="text-[11px] text-on-surface-2 tabular-nums">{headings.length}</span>
        {onClose && (
          <button
            type="button"
            aria-label="收起大纲"
            onClick={onClose}
            className="grid place-items-center w-6 h-6 rounded-md text-on-surface-2 hover:text-on-surface hover:bg-surface-3 cursor-pointer"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
        {headings.length === 0 ? (
          <p className="text-[11.5px] text-on-surface-2 px-2 py-4 text-center">
            输入 <code className="font-mono"># 标题</code> 后将自动生成大纲
          </p>
        ) : (
          headings.map((h, i) => (
            <button
              key={`${h.blockIdx}-${i}`}
              type="button"
              onClick={() => onSelectHeading(i, h.text)}
              title={h.text}
              style={{ paddingLeft: `${8 + Math.min(h.level - 1, 5) * 12}px` }}
              className={cn(
                'w-full text-left pr-2 py-1.5 rounded-[8px] text-[12px] leading-snug truncate transition-colors cursor-pointer',
                h.level === 1 ? 'font-semibold text-on-surface' : 'text-on-surface-2 hover:text-on-surface',
                'hover:bg-surface-3/70',
              )}
            >
              <span className="text-[10px] text-on-surface-2/60 mr-1 font-mono">H{h.level}</span>
              {h.text || '（空标题）'}
            </button>
          ))
        )}
      </nav>
    </aside>
  )
}
