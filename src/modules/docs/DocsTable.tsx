import { BookOpen, FolderInput, MoreHorizontal, PenLine, Quote, Share2, Star, Tag, Trash2 } from 'lucide-react'
import { DOC_KIND_LABEL, type Doc, type Folder } from '@/db/db'
import { fmtListDate } from '@/lib/date'
import { cn } from '@/lib/cn'
import { FileTypeIcon } from '@/shared/FileTypeIcon'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem as DropdownItem, MenuSeparator } from '@/shared/ui/Menu'
import { effectiveReadStatus, folderPathName } from './libraryModel'

const STATUS_BADGE = {
  unread: { text: '未读', cls: 'bg-surface-3 text-on-surface-2' },
  reading: { text: '在读', cls: 'bg-primary-soft text-primary' },
  done: { text: '已读', cls: 'bg-ok/15 text-ok' },
} as const

export function DocsTable({
  rows,
  folders,
  progressMap,
  annCountByHash,
  onOpen,
  onRead,
  onEdit,
  onShare,
  onMove,
  onToggleStar,
  onEditMeta,
  onOpenCitation,
  onRequestConfirm,
}: {
  rows: { doc: Doc; hit?: { count: number; snippet: string; seg?: number } }[]
  folders: readonly Folder[]
  progressMap: Record<string, { progressPct?: number }>
  annCountByHash: Record<string, number>
  onOpen: (doc: Doc, hit?: { count: number; snippet: string; seg?: number }) => void
  onRead: (doc: Doc) => void
  onEdit: (doc: Doc) => void
  onShare: (doc: Doc) => void
  onMove: (doc: Doc) => void
  onToggleStar: (doc: Doc) => void
  onEditMeta: (doc: Doc) => void
  onOpenCitation: (doc: Doc) => void
  onRequestConfirm: (doc: Doc) => void
}) {
  return (
    <div className="rounded-[14px] border border-outline bg-surface overflow-x-auto">
      <table className="w-full text-left border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-outline/80 text-[11.5px] text-on-surface-2 bg-surface-2/60">
            <th className="w-9 py-2.5 pl-3 pr-1 font-medium" aria-label="星标" />
            <th className="py-2.5 px-2 font-medium min-w-[220px]">标题 / 文献来源</th>
            <th className="py-2.5 px-2 font-medium hidden sm:table-cell whitespace-nowrap">格式</th>
            <th className="py-2.5 px-2 font-medium hidden md:table-cell">标签 / 目录</th>
            <th className="py-2.5 px-2 font-medium text-right whitespace-nowrap">批注</th>
            <th className="py-2.5 px-2 font-medium whitespace-nowrap">状态 · 进度</th>
            <th className="py-2.5 px-2 font-medium hidden lg:table-cell whitespace-nowrap">最近打开</th>
            <th className="w-10 py-2.5 pr-2 font-medium" aria-label="操作" />
          </tr>
        </thead>
        <tbody className="divide-y divide-outline/50">
          {rows.map(({ doc: d, hit }) => {
            const pct = Math.round((progressMap[d.hash]?.progressPct ?? 0) * 100)
            const status = effectiveReadStatus(d, progressMap[d.hash]?.progressPct ?? 0)
            const badge = STATUS_BADGE[status]
            const anns = annCountByHash[d.hash] ?? 0
            const folderPath = folderPathName(d.folderId, folders)
            const metaLine = [d.meta?.author, d.meta?.year, d.meta?.venue].filter(Boolean).join(' · ')
            return (
              <tr key={d.id} id={`doc-${d.id}`} className="group hover:bg-surface-2/70 transition-colors">
                <td className="py-2.5 pl-3 pr-1 align-top">
                  <button
                    type="button"
                    aria-label={d.starred ? '取消星标' : '加星标'}
                    onClick={() => onToggleStar(d)}
                    className={cn(
                      'grid place-items-center w-7 h-7 rounded-[7px] cursor-pointer',
                      d.starred ? 'text-p1' : 'text-on-surface-2/50 hover:text-on-surface',
                    )}
                  >
                    <Star size={14} fill={d.starred ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="py-2.5 px-2 align-top">
                  <button type="button" onClick={() => onOpen(d, hit)} className="text-left w-full flex items-start gap-2.5 cursor-pointer">
                    <span className="shrink-0 mt-0.5"><FileTypeIcon kind={d.kind} size={20} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-on-surface line-clamp-1 group-hover:text-primary transition-colors">{d.title}</span>
                      {metaLine && <span className="block text-[11.5px] text-on-surface-2 truncate">{metaLine}</span>}
                      {hit && (
                        <span className="block text-[11.5px] text-on-surface-2 line-clamp-1 mt-0.5">
                          <span className="text-primary font-medium">{hit.count}处命中：</span>{hit.snippet}
                        </span>
                      )}
                    </span>
                  </button>
                </td>
                <td className="py-2.5 px-2 align-top hidden sm:table-cell text-[12px] text-on-surface-2 whitespace-nowrap">
                  {DOC_KIND_LABEL[d.kind]}
                </td>
                <td className="py-2.5 px-2 align-top hidden md:table-cell max-w-[200px]">
                  <div className="flex flex-wrap gap-1">
                    {folderPath && (
                      <span className="px-1.5 py-0.5 rounded bg-surface-3 text-[11px] text-on-surface-2 truncate max-w-[140px]">
                        {folderPath}
                      </span>
                    )}
                    {(d.tags ?? []).slice(0, 2).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded border border-outline/70 text-[11px] text-on-surface-2">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2.5 px-2 align-top text-right tabular-nums text-[12px] text-on-surface-2">
                  {anns > 0 ? anns : '—'}
                </td>
                <td className="py-2.5 px-2 align-top whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', badge.cls)}>{badge.text}</span>
                    <span className="text-[11.5px] tabular-nums text-on-surface-2">{pct}%</span>
                  </div>
                </td>
                <td className="py-2.5 px-2 align-top hidden lg:table-cell text-[12px] text-on-surface-2 whitespace-nowrap">
                  {fmtListDate(d.lastOpenedAt ?? d.addedAt)}
                </td>
                <td className="py-2 pr-2 align-top text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`文档操作：${d.title}`} className="grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer">
                        <MoreHorizontal size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <MenuContent>
                      <DropdownItem onSelect={() => onRead(d)}><BookOpen size={15} />继续阅读</DropdownItem>
                      {d.kind === 'md' && <DropdownItem onSelect={() => onEdit(d)}><PenLine size={15} />继续写作</DropdownItem>}
                      <DropdownItem onSelect={() => onEditMeta(d)}><Tag size={15} />文献信息与标签</DropdownItem>
                      <DropdownItem onSelect={() => onToggleStar(d)}><Star size={15} />{d.starred ? '取消星标' : '设为星标'}</DropdownItem>
                      <DropdownItem onSelect={() => onOpenCitation(d)}><Quote size={15} />引用…</DropdownItem>
                      {d.kind === 'md' && <DropdownItem onSelect={() => onShare(d)}><Share2 size={15} />分享 / 导出</DropdownItem>}
                      <DropdownItem onSelect={() => onMove(d)}><FolderInput size={15} />移动到文件夹</DropdownItem>
                      <MenuSeparator />
                      <DropdownItem danger onSelect={() => onRequestConfirm(d)}><Trash2 size={15} />删除文档…</DropdownItem>
                    </MenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
