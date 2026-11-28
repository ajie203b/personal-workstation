import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Doc } from '@/db/db'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { cn } from '@/lib/cn'
import { CITATION_STYLE_OPTIONS, formatCitation, type CitationStyle } from './citation'

export function CitationDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const toast = useUi((state) => state.toast)
  const [style, setStyle] = useState<CitationStyle>('gbt7714')
  const [copied, setCopied] = useState(false)

  const preview = useMemo(() => formatCitation(doc, style), [doc, style])
  const currentLabel = CITATION_STYLE_OPTIONS.find((o) => o.value === style)?.label ?? style

  async function copy(targetStyle = style, label = currentLabel) {
    try {
      await navigator.clipboard.writeText(formatCitation(doc, targetStyle))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
      toast(`已复制 ${label} 引文`)
    } catch {
      toast('复制失败，请重试')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="生成引文" description={doc.title} widthClass="w-[min(560px,92vw)]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="引文格式">
          {CITATION_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={style === opt.value}
              onClick={() => { setStyle(opt.value); setCopied(false) }}
              className={cn(
                'h-8 px-2.5 rounded-[9px] text-[12.5px] font-medium transition-colors cursor-pointer',
                style === opt.value
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-2 text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <pre className="rounded-[12px] border border-outline bg-surface-2 p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap break-all font-mono text-on-surface select-all max-h-56 overflow-y-auto">
          {preview}
        </pre>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制' : `复制 ${currentLabel}`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
