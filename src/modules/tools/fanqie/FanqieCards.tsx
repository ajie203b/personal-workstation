import { useState } from 'react'
import { BookOpen, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { FanqieJob } from '@/stores/fanqie'
import type { FanqieBook } from '@/db/db'
import { formatDate, formatWordCount, type FanqieBookInfo } from '@/lib/fanqie'
import type { FanqieSearchItem } from '@/lib/fanqieFqweb'
import { cn } from '@/lib/cn'

export function Cover({ src, title, className }: { src?: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className={cn('grid place-items-center bg-surface-3 text-on-surface-2 shrink-0', className)} aria-hidden>
        <BookOpen size={20} />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={`《${title}》封面`}
      referrerPolicy="no-referrer"
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('object-cover bg-surface-3 shrink-0', className)}
    />
  )
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return null
  const done = status.includes('完结')
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium shrink-0',
        done ? 'bg-ok/10 text-ok' : 'bg-primary-soft text-primary',
      )}
    >
      {status}
    </span>
  )
}

export function SearchResultCard({ item, onClick }: { item: FanqieSearchItem; onClick: () => void }) {
  const meta = [formatWordCount(item.wordCount), item.chapterCount ? `${item.chapterCount} 章` : ''].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={onClick}
      className="card card-hover press p-3 flex gap-3 text-left w-full cursor-pointer select-none"
    >
      <Cover src={item.cover} title={item.title} className="w-12 h-16 rounded-[8px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="text-[13.5px] font-medium leading-5 min-w-0 break-words">{item.title}</p>
          <StatusPill status={item.status} />
        </div>
        <p className="text-[11.5px] text-on-surface-2 mt-0.5 truncate">{item.author || '佚名'}</p>
        {item.aliases?.length ? <p className="text-[11px] text-on-surface-2 mt-1 break-words">又名 {item.aliases.join('、')}</p> : null}
        <p className="text-[11px] text-on-surface-2 mt-1 tabular-nums">{meta || '点击查看详情'}</p>
        {item.abstract && <p className="text-[11px] text-on-surface-2 mt-1 line-clamp-2 leading-relaxed">{item.abstract}</p>}
      </div>
      <span className="self-center text-[11.5px] text-primary shrink-0">查看</span>
    </button>
  )
}

export function BookCard({ book, downloaded }: { book: FanqieBookInfo; downloaded: number }) {
  const [expanded, setExpanded] = useState(false)
  const words = formatWordCount(book.wordCount)
  const updated = formatDate(book.updatedAt)
  return (
    <section className="card p-4">
      <div className="flex gap-3.5">
        <Cover src={book.cover} title={book.title} className="w-[76px] h-[104px] rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h2 className="text-[17px] font-bold leading-6 min-w-0 break-words">{book.title}</h2>
            <StatusPill status={book.status} />
          </div>
          <p className="text-[12.5px] text-on-surface-2 mt-1 truncate">{book.author}</p>
          <p className="text-[11.5px] text-on-surface-2 mt-1.5 tabular-nums">
            {words && <>{words} · </>}
            {book.chapters.length || book.chapterCount} 章
            {updated && <> · {updated}</>}
          </p>
          {book.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {book.tags.slice(0, 4).map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded-[6px] bg-surface-3 text-[10.5px] text-on-surface-2">
                  {t}
                </span>
              ))}
            </div>
          )}
          {downloaded > 0 && (
            <p className="text-[11.5px] text-primary mt-2 tabular-nums">本地已存 {downloaded} 章</p>
          )}
        </div>
      </div>

      {book.abstract && (
        <div className="mt-3">
          <p className={cn('text-[12px] text-on-surface-2 leading-relaxed whitespace-pre-line', !expanded && 'line-clamp-3')}>
            {book.abstract}
          </p>
          {book.abstract.length > 110 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11.5px] text-primary mt-1 hover:underline cursor-pointer"
            >
              {expanded ? '收起' : '展开简介'}
            </button>
          )}
        </div>
      )}

      <p className="mt-3 pt-3 border-t border-outline text-[11.5px] text-on-surface-2 leading-relaxed">
        共 {book.chapters.length} 章，正文接口不需要登录即可下载。
      </p>
    </section>
  )
}

export function ProgressCard({
  job,
  processed,
  onPause,
  onResume,
  onClose,
}: {
  job: FanqieJob
  processed: number
  onPause: () => void
  onResume: () => void
  onClose: () => void
}) {
  const pct = job.total ? Math.min(100, Math.round((processed / job.total) * 100)) : job.phase === 'done' ? 100 : 0
  const running = job.phase === 'running'
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <RefreshCw size={15} className={cn('text-primary shrink-0', running && 'animate-spin')} />
        <p className="text-[13px] font-medium min-w-0 flex-1 truncate">
          {job.phase === 'running' ? '正在下载' : job.phase === 'paused' ? '已暂停' : job.phase === 'done' ? '下载完成' : '下载中断'}
          《{job.title}》
        </p>
        <span className="text-[11.5px] text-on-surface-2 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-3 mt-2.5 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', job.phase === 'error' ? 'bg-danger' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-3 mt-2 text-[11.5px] text-on-surface-2 flex-wrap">
        <span className="tabular-nums">完成 {job.done}</span>
        {job.failed > 0 && <span className="text-danger tabular-nums">失败 {job.failed}</span>}
        {job.skipped > 0 && <span className="text-p1 tabular-nums">跳过 {job.skipped}</span>}
        <span className="tabular-nums">共 {job.total}</span>
        {job.current && <span className="truncate max-w-[220px]">{job.current}</span>}
        <span className="flex-1" />
        {running && (
          <Button size="sm" variant="outline" onClick={onPause}>
            <Pause size={13} /> 暂停
          </Button>
        )}
        {(job.phase === 'paused' || job.phase === 'error') && (
          <Button size="sm" variant="outline" onClick={onResume}>
            <Play size={13} /> {job.phase === 'error' ? '重试未完成章节' : '继续'}
          </Button>
        )}
        {!running && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>
      {job.error && <p className="text-[11.5px] text-danger mt-1.5 leading-relaxed">{job.error}</p>}
    </section>
  )
}

export function LibraryRow({
  book,
  busyAction,
  onOpen,
  onRead,
  onExport,
  onDelete,
}: {
  book: FanqieBook
  busyAction: string
  onOpen: () => void
  onRead: () => void
  onExport: (format: 'txt' | 'epub') => void
  onDelete: () => void
}) {
  const pct = book.chapterCount ? Math.min(100, Math.round((book.downloadedCount / book.chapterCount) * 100)) : 0
  const readBusy = busyAction === `read:${book.id}`
  const txtBusy = busyAction === `txt:${book.id}`
  const epubBusy = busyAction === `epub:${book.id}`
  const delBusy = busyAction === `del:${book.id}`
  return (
    <div className="flex gap-3 py-3">
      <button type="button" onClick={onOpen} className="shrink-0 cursor-pointer" aria-label={`查看《${book.title}》`}>
        <Cover src={book.cover} title={book.title} className="w-12 h-16 rounded-[8px]" />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="text-left max-w-full cursor-pointer">
          <p className="text-[13px] font-medium truncate hover:text-primary transition-colors">{book.title}</p>
          <p className="text-[11px] text-on-surface-2 mt-0.5 truncate">
            {book.author} · {book.downloadedCount} / {book.chapterCount} 章
          </p>
        </button>
        <div className="h-1 rounded-full bg-surface-3 mt-1.5 overflow-hidden max-w-[180px]">
          <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <Button size="sm" variant="outline" state={readBusy ? 'loading' : 'idle'} disabled={!book.downloadedCount || Boolean(busyAction)} onClick={onRead}>
            阅读
          </Button>
          <Button size="sm" variant="ghost" state={txtBusy ? 'loading' : 'idle'} disabled={!book.downloadedCount || Boolean(busyAction)} onClick={() => onExport('txt')}>
            TXT
          </Button>
          <Button size="sm" variant="ghost" state={epubBusy ? 'loading' : 'idle'} disabled={!book.downloadedCount || Boolean(busyAction)} onClick={() => onExport('epub')}>
            EPUB
          </Button>
          <button
            type="button"
            aria-label={`删除《${book.title}》的本地正文`}
            title="删除本地正文"
            disabled={Boolean(busyAction)}
            onClick={onDelete}
            className="ml-auto grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-40 cursor-pointer"
          >
            <Trash2 size={15} className={cn(delBusy && 'animate-pulse')} />
          </button>
        </div>
      </div>
    </div>
  )
}
