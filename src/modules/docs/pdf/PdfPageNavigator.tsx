import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  center: number
  numPages: number
  scrollToPdfPage: (page: number) => void
}

export function PdfPageNavigator({ center, numPages, scrollToPdfPage }: Props) {
  const [pageDraft, setPageDraft] = useState<string | null>(null)
  if (!numPages) return null

  return (
    <div className="pdf-floating-pill absolute bottom-3 left-3 z-10 flex items-center gap-0.5 min-h-11 px-1.5 rounded-full bg-surface border border-outline shadow-sm text-[12px] text-on-surface-2">
      <button
        type="button"
        aria-label="上一页"
        disabled={center <= 1}
        onClick={() => scrollToPdfPage(center - 1)}
        className="grid place-items-center size-11 rounded-full hover:bg-surface-3 disabled:opacity-35 cursor-pointer disabled:cursor-default"
      >
        <ChevronLeft size={14} />
      </button>
      <form
        className="flex items-center gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault()
          const raw = pageDraft ?? String(center)
          const n = Number(raw)
          setPageDraft(null)
          if (Number.isFinite(n) && n >= 1) scrollToPdfPage(Math.min(numPages, Math.round(n)))
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          aria-label="跳转页码"
          value={pageDraft ?? String(center)}
          onFocus={(e) => {
            setPageDraft(String(center))
            e.currentTarget.select()
          }}
          onChange={(e) => setPageDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => {
            if (pageDraft !== null && pageDraft !== '') {
              const n = Number(pageDraft)
              if (Number.isFinite(n) && n >= 1) scrollToPdfPage(Math.min(numPages, Math.round(n)))
            }
            setPageDraft(null)
          }}
          className="size-11 bg-transparent text-center tabular-nums text-on-surface font-medium outline-none focus:bg-surface-3/70 rounded"
        />
        <span className="tabular-nums text-on-surface-2/80 select-none">/ {numPages}</span>
      </form>
      <button
        type="button"
        aria-label="下一页"
        disabled={center >= numPages}
        onClick={() => scrollToPdfPage(center + 1)}
        className="grid place-items-center size-11 rounded-full hover:bg-surface-3 disabled:opacity-35 cursor-pointer disabled:cursor-default"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
