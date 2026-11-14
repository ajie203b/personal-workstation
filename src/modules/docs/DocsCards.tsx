import { useEffect, useState } from 'react'
import { BookOpen, FileType2, FolderInput, MoreHorizontal, Quote, Star, Tag, Trash2 } from 'lucide-react'
import { DOC_KIND_LABEL, type Doc } from '@/db/db'
import { FileTypeIcon } from '@/shared/FileTypeIcon'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem as DropdownItem, MenuSeparator } from '@/shared/ui/Menu'
import { fmtListDate } from '@/lib/date'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'

function segLabel(kind: Doc['kind'], seg: number): string {
  if (kind === 'pdf') return `第${seg}页`
  if (kind === 'pptx') return `第${seg}片`
  if (kind === 'epub') return `第${seg}章`
  return `#${seg}`
}

export interface DocCardProps {
  doc: Doc
  pct: number
  hit?: { count: number; snippet: string; seg?: number }
  onToggleStar?: () => void
  onEditMeta?: () => void
  onOpenCitation: () => void
  onMove: () => void
  onOpen: () => void
  onRead: () => void
  onRequestConfirm: () => void
}

/** 阅读是主动作，菜单集中承载次要操作，卡片高度随内容变化。 */
export function DocCard({
  doc: d, pct, hit, onToggleStar, onEditMeta, onOpenCitation, onMove, onOpen, onRead, onRequestConfirm,
}: DocCardProps) {
  return (
    <article id={`doc-${d.id}`} className="card card-hover group relative flex items-start overflow-hidden">
      <button type="button" onClick={onOpen} aria-label={`阅读 ${d.title}`} className="flex flex-1 min-w-0 items-start gap-3 p-3 pr-0 text-left cursor-pointer">
        <span className="grid place-items-center w-10 h-12 rounded-[10px] bg-surface-2 shrink-0" aria-hidden>
          <FileTypeIcon kind={d.kind} size={30} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-ui-body font-medium leading-6 line-clamp-2">{d.title}</span>
          <span className="block text-ui-caption text-on-surface-2 mt-0.5 truncate">
            {DOC_KIND_LABEL[d.kind]} · {formatBytes(d.size)} · {fmtListDate(d.lastOpenedAt ?? d.addedAt)}
          </span>
          {hit && (
            <span className="block text-ui-caption text-on-surface mt-2 leading-relaxed line-clamp-2">
              <span className="text-primary font-medium">{hit.count} 处命中{hit.seg ? ` · ${segLabel(d.kind, hit.seg)}` : ''}：</span>{hit.snippet}
            </span>
          )}
          {pct > 0 && <span className="flex items-center gap-2 mt-2">
            <span className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden">
              <span className={cn('block h-full w-full rounded-full transition-transform duration-300 origin-left', pct >= 100 ? 'bg-ok' : 'bg-primary/70')} style={{ transform: `scaleX(${pct / 100})` }} />
            </span>
            <span className="text-[12px] text-on-surface-2 tabular-nums">{pct}%</span>
          </span>}
        </span>
      </button>
      <div className="flex items-center shrink-0 p-1">
        {d.starred && <Star size={13} className="text-p1" fill="currentColor" aria-label="已星标" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} aria-label={`文档操作：${d.title}`} className="grid place-items-center w-11 h-11 md:w-8 md:h-8 rounded-[9px] shrink-0 text-on-surface-2 hover:bg-surface-2 hover:text-on-surface cursor-pointer transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            <DropdownItem onSelect={onRead}><BookOpen size={16} aria-hidden />继续阅读</DropdownItem>
            {onEditMeta && <DropdownItem onSelect={onEditMeta}><Tag size={16} aria-hidden />文献信息与标签</DropdownItem>}
            {onToggleStar && <DropdownItem onSelect={onToggleStar}><Star size={16} aria-hidden />{d.starred ? '取消星标' : '设为星标'}</DropdownItem>}
            <DropdownItem onSelect={onOpenCitation}><Quote size={16} aria-hidden />引用…</DropdownItem>
            <DropdownItem onSelect={onMove}><FolderInput size={16} aria-hidden />移动到文件夹</DropdownItem>
            <MenuSeparator />
            <DropdownItem danger onSelect={onRequestConfirm}><Trash2 size={16} aria-hidden />删除文档…</DropdownItem>
          </MenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

/**
 * 导入中的卡片（ui-motion 43「照片上传进度」的信息版）：
 * 卡片先到位、占住真实卡片的位置，扫光条来回走，等指纹算完再换成真卡。
 * 大 PDF 算 SHA-256 要好几百毫秒起步，之前点完「导入」什么都不动，像没反应。
 */
export function ImportingCard({ name, at }: { name: string; at: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - at) / 100) / 10), 200)
    return () => window.clearInterval(id)
  }, [at])
  return (
    <div className="card relative overflow-hidden px-4 py-3.5 flex gap-3.5" aria-live="polite">
      <span className="grid place-items-center w-11 h-11 rounded-[12px] text-on-surface-2/80 shrink-0">
        <FileType2 size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold truncate">{name}</span>
        <span className="block text-[12px] text-on-surface-2 mt-0.5 tabular-nums">
          正在计算内容指纹… {elapsed > 0 ? `${elapsed.toFixed(1)}s` : ''}
        </span>
        <span className="flex items-center gap-2 mt-2">
          <span className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden skeleton" />
        </span>
      </span>
    </div>
  )
}
