import { useEffect, useState } from 'react'
import { BookOpen, FileType2, FolderInput, Highlighter, MoreHorizontal, PenLine, Quote, Share2, Star, Tag, Trash2 } from 'lucide-react'
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

const READ_STATUS_LABEL = {
  unread: '未读',
  reading: '在读',
  done: '已读',
} as const

export interface DocCardProps {
  doc: Doc
  pct: number
  annCount?: number
  hit?: { count: number; snippet: string; seg?: number }
  folderName?: string
  onToggleStar?: () => void
  onEditMeta?: () => void
  onCopyCitation?: (style: 'bibtex' | 'ris') => void
  onMove: () => void
  onOpen: () => void
  onEdit: () => void
  onRead: () => void
  onShare: () => void
  onRequestConfirm: () => void
}

/** 阅读是主动作，菜单集中承载次要操作，卡片高度随内容变化。 */
export function DocCard({
  doc: d, pct, annCount = 0, hit, folderName, onToggleStar, onEditMeta, onCopyCitation, onMove, onOpen, onEdit, onRead, onShare, onRequestConfirm,
}: DocCardProps) {
  const metaLine = [d.meta?.author, d.meta?.year, d.meta?.venue].filter(Boolean).join(' · ')
  return (
    <article id={`doc-${d.id}`} className="card card-hover group relative flex items-start overflow-hidden">
      <button type="button" onClick={onOpen} aria-label={`阅读 ${d.title}`} className="flex flex-1 min-w-0 items-start gap-3 p-4 pr-1 text-left cursor-pointer">
        <span className="grid place-items-center w-10 h-12 rounded-[10px] bg-surface-2 shrink-0" aria-hidden>
          <FileTypeIcon kind={d.kind} size={30} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-ui-body font-medium leading-6 line-clamp-2">{d.title}</span>
          {metaLine && (
            <span className="block text-[11.5px] text-on-surface-2 mt-0.5 truncate">{metaLine}</span>
          )}
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui-caption text-on-surface-2 mt-1 leading-5">
            <span>{DOC_KIND_LABEL[d.kind]} · {formatBytes(d.size)}</span>
            {annCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-primary/90">
                · <Highlighter size={11} /> {annCount}
              </span>
            )}
            {d.readStatus && <span>· {READ_STATUS_LABEL[d.readStatus]}</span>}
          </span>
          <span className="block text-ui-caption text-on-surface-2 leading-5 truncate">
            {d.lastOpenedAt
              ? `上次阅读 ${fmtListDate(d.lastOpenedAt)}`
              : `添加于 ${fmtListDate(d.addedAt)}`}
            {folderName && ` · ${folderName}`}
          </span>
          {d.tags && d.tags.length > 0 && (
            <span className="flex flex-wrap gap-1 mt-1.5">
              {d.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-2 border border-outline/70 text-[10.5px] text-on-surface-2">
                  {tag}
                </span>
              ))}
              {d.tags.length > 3 && <span className="text-[10.5px] text-on-surface-2">+{d.tags.length - 3}</span>}
            </span>
          )}
          {hit && (
            <span className="block text-ui-caption text-on-surface mt-2 leading-relaxed line-clamp-2">
              <span className="text-primary font-medium">{hit.count} 处命中{hit.seg ? ` · ${segLabel(d.kind, hit.seg)}` : ''}：</span>{hit.snippet}
            </span>
          )}
          <span className="flex items-center gap-2 mt-2.5">
            <span className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden">
              <span className={cn('block h-full w-full rounded-full transition-transform duration-300 origin-left', pct >= 100 ? 'bg-ok' : 'bg-primary/70')} style={{ transform: `scaleX(${pct / 100})` }} />
            </span>
            <span className="text-[12px] text-on-surface-2 tabular-nums">{pct}%</span>
          </span>
        </span>
      </button>
      <div className="flex flex-col items-center shrink-0 m-1.5 ml-0">
        {onToggleStar && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleStar() }}
            aria-label={d.starred ? '取消星标' : '加星标'}
            title={d.starred ? '取消星标' : '加星标'}
            className={cn(
              'grid place-items-center w-8 h-8 rounded-[9px] cursor-pointer transition-opacity',
              d.starred ? 'text-p1 opacity-100' : 'text-on-surface-2 hover:text-on-surface md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
            )}
          >
            <Star size={16} fill={d.starred ? 'currentColor' : 'none'} />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} aria-label={`文档操作：${d.title}`} className="grid place-items-center w-8 h-8 rounded-[9px] shrink-0 text-on-surface-2 hover:bg-surface-2 hover:text-on-surface cursor-pointer transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            <DropdownItem onSelect={onRead}><BookOpen size={16} aria-hidden />继续阅读</DropdownItem>
            {d.kind === 'md' && <DropdownItem onSelect={onEdit}><PenLine size={16} aria-hidden />继续写作</DropdownItem>}
            {onEditMeta && <DropdownItem onSelect={onEditMeta}><Tag size={16} aria-hidden />文献信息与标签</DropdownItem>}
            {onToggleStar && <DropdownItem onSelect={onToggleStar}><Star size={16} aria-hidden />{d.starred ? '取消星标' : '设为星标'}</DropdownItem>}
            {onCopyCitation && <DropdownItem onSelect={() => onCopyCitation('bibtex')}><Quote size={16} aria-hidden />复制 BibTeX 引文</DropdownItem>}
            {onCopyCitation && <DropdownItem onSelect={() => onCopyCitation('ris')}><Quote size={16} aria-hidden />复制 RIS 引文</DropdownItem>}
            {d.kind === 'md' && <DropdownItem onSelect={onShare}><Share2 size={16} aria-hidden />分享 / 导出</DropdownItem>}
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
