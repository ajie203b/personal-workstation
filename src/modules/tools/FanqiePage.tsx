import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  Download,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { IconBook } from '@/shared/icons'
import { Button } from '@/shared/ui/Button'
import { BackButton } from '@/shared/ui/BackButton'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { useFanqie, type FanqieJob } from '@/stores/fanqie'
import { deleteFanqieBook, getDownloadedItemIds, getFanqieBook, getFanqieChapterRows, listFanqieBooks } from '@/db/fanqie'
import type { FanqieBook } from '@/db/db'
import { formatDate, formatWordCount, parseFanqieRef, type FanqieBookInfo } from '@/lib/fanqie'
import {
  FqwebError,
  fetchFanqieBookById,
  fetchFanqieBookByRef,
  searchFanqieBooks,
  type FanqieSearchItem,
} from '@/lib/fanqieFqweb'
import { buildFanqieEpub, buildFanqieTxt, importFanqieToDocs, sanitizeFilename, saveBlob } from '@/lib/fanqieExport'
import { openExternal } from '@/lib/links'
import { isNative } from '@/lib/native'
import { cn } from '@/lib/cn'

/**
 * 番茄小说下载器（v2.2）
 *
 * 用户只需要搜书名（或贴番茄链接）→ 选书 → 下载；没有接口地址、Cookie、代理等设置。
 * 正文/目录走公开 FQWeb 节点（不登录也能拿全本，含锁定章），搜索优先 FQWeb，
 * 公共节点搜索报错时用 Bing RSS 找 fanqienovel.com/page 的书籍 ID。
 */
export function FanqiePage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const job = useFanqie((s) => s.job)
  const start = useFanqie((s) => s.start)
  const pause = useFanqie((s) => s.pause)
  const resume = useFanqie((s) => s.resume)
  const clearJob = useFanqie((s) => s.clear)

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FanqieSearchItem[] | null>(null)
  const [book, setBook] = useState<FanqieBookInfo | null>(null)
  const [loadingBook, setLoadingBook] = useState(false)
  const [error, setError] = useState('')
  const [rangeMode, setRangeMode] = useState<'auto' | 'first' | 'custom'>('auto')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<FanqieBook | null>(null)

  const library = useLiveQuery(() => listFanqieBooks(), []) ?? []
  const downloadedIds = useLiveQuery(
    () => (book ? getDownloadedItemIds(book.bookId) : Promise.resolve(new Set<string>())),
    [book?.bookId],
  ) ?? new Set<string>()
  const localBook = useLiveQuery(
    () => (book ? getFanqieBook(book.bookId) : Promise.resolve(undefined)),
    [book?.bookId],
  )

  const selected = useMemo(() => {
    if (!book || !book.chapters.length) return []
    if (rangeMode === 'first') return book.chapters.slice(0, 20)
    if (rangeMode === 'custom') {
      const max = book.chapters.length
      const a = clamp(Number(from) || 1, 1, max)
      const b = clamp(Number(to) || max, a, max)
      return book.chapters.slice(a - 1, b)
    }
    return book.chapters
  }, [book, rangeMode, from, to])

  const pending = selected.filter((c) => !downloadedIds.has(c.itemId))
  const thisJob = job && book && job.bookId === book.bookId ? job : null
  const runningThis = thisJob?.phase === 'running'
  const runningOther = job?.phase === 'running' && book && job.bookId !== book.bookId
  const processed = job ? job.done + job.failed + job.skipped : 0
  const busy = searching || loadingBook

  const scrollTop = () => document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })

  /** 三个入口（搜索 / 粘贴链接 / 书架）共用同一套打开状态 */
  const applyBook = (info: FanqieBookInfo) => {
    setBook(info)
    setRangeMode('auto')
    setFrom('1')
    setTo(String(info.chapters.length || info.chapterCount))
    scrollTop()
  }

  const openBook = async (bookId: string) => {
    setLoadingBook(true)
    setError('')
    try {
      applyBook(await fetchFanqieBookById(bookId))
    } catch (e) {
      setError(bookErrorMessage(e))
    } finally {
      setLoadingBook(false)
    }
  }

  const doSearch = async () => {
    const q = query.trim()
    if (!q || busy) return
    setError('')
    setResults(null)
    setBook(null)
    const ref = parseFanqieRef(q)
    if (ref) {
      setLoadingBook(true)
      try {
        applyBook(await fetchFanqieBookByRef(ref))
      } catch (e) {
        setError(searchErrorMessage(e))
      } finally {
        setLoadingBook(false)
      }
      return
    }

    setSearching(true)
    try {
      const items = await searchFanqieBooks(q)
      setResults(items)
      if (items.length === 1) await openBook(items[0].bookId)
    } catch (e) {
      setError(searchErrorMessage(e))
    } finally {
      setSearching(false)
    }
  }

  const backToResults = () => {
    setBook(null)
    setError('')
    scrollTop()
  }

  const beginDownload = () => {
    if (!book || !pending.length) return
    if (runningOther) {
      toast('另一个下载任务还在进行，先暂停它')
      return
    }
    void start(book, selected).catch((e) => {
      toast(e instanceof Error ? e.message : '启动下载失败')
    })
  }

  const openLibraryBook = (b: FanqieBook) => {
    setResults(null)
    setQuery(b.title)
    setError('')
    applyBook(libraryToInfo(b))
  }

  const readBook = async (b: FanqieBook) => {
    const key = `read:${b.id}`
    if (busyAction) return
    setBusyAction(key)
    try {
      const rows = await getFanqieChapterRows(b.id)
      if (!rows.length) {
        toast('这本书还没有下载正文')
        return
      }
      const docId = await importFanqieToDocs(b, rows)
      toast(`已导入文档：${b.title}`)
      navigate(`/docs/${docId}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入文档失败')
    } finally {
      setBusyAction('')
    }
  }

  const exportBook = async (b: FanqieBook, format: 'txt' | 'epub') => {
    const key = `${format}:${b.id}`
    if (busyAction) return
    setBusyAction(key)
    try {
      const rows = await getFanqieChapterRows(b.id)
      if (!rows.length) {
        toast('这本书还没有下载正文')
        return
      }
      const blob = format === 'txt' ? buildFanqieTxt(b, rows) : await buildFanqieEpub(b, rows)
      const where = await saveBlob(blob, `${sanitizeFilename(b.title)}.${format}`)
      toast(`已导出 ${format.toUpperCase()}（${rows.length} 章）→ ${where}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败')
    } finally {
      setBusyAction('')
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    const b = confirmDelete
    setConfirmDelete(null)
    setBusyAction(`del:${b.id}`)
    try {
      await deleteFanqieBook(b.id)
      if (book?.bookId === b.id) setBook(null)
      toast(`已删除《${b.title}》的本地正文`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusyAction('')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconBook size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">番茄小说</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            搜书名 / 作者，下载全本到本地书架 · TXT / EPUB
          </p>
        </div>
      </header>

      {job && (
        <ProgressCard
          job={job}
          processed={processed}
          onPause={pause}
          onResume={() => void resume().catch((e) => toast(e instanceof Error ? e.message : '继续下载失败'))}
          onClose={clearJob}
        />
      )}

      <form
        className="card p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void doSearch()
        }}
      >
        <label htmlFor="fq-search" className="text-[13px] font-medium">
          搜书名 / 作者
        </label>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
            <input
              id="fq-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：我不是戏神 / 三九音域"
              enterKeyHint="search"
              className="w-full h-10 pl-9 pr-3 rounded-[10px] bg-surface border border-outline text-[13.5px] outline-none focus:border-primary/60 placeholder:text-on-surface-2/70"
            />
          </div>
          <Button type="submit" variant="primary" size="md" state={busy ? 'loading' : 'idle'} className="shrink-0">
            搜索
          </Button>
        </div>
        <p className="text-[11.5px] text-on-surface-2 mt-2 leading-relaxed">
          建议输入完整书名；也可以直接粘贴番茄书籍 / 章节链接或纯数字 ID。
          {!isNative() && ' 网页版搜索需要先运行 node scripts/fanqie-proxy.mjs；下载正文不需要代理。'}
        </p>
      </form>

      {error && (
        <div className="card p-3.5 flex items-start gap-2.5 border-danger/25">
          <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
          <p className="text-[12.5px] leading-relaxed">{error}</p>
        </div>
      )}

      {!book && results && results.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[13.5px] font-semibold">搜索结果</h2>
            <span className="text-[11.5px] text-on-surface-2 tabular-nums">{results.length} 本</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {results.map((item) => (
              <SearchResultCard key={item.bookId} item={item} onClick={() => void openBook(item.bookId)} />
            ))}
          </div>
        </section>
      )}

      {!book && results && results.length === 0 && (
        <div className="card">
          <EmptyState compact icon={Search} title="没搜到这本书" hint="换个书名或作者试试，也可以直接粘贴书籍链接或 ID。" />
        </div>
      )}

      {!book && !results && !error && !busy && (
        <div className="card">
          <EmptyState
            compact
            icon={Search}
            title="搜一本番茄小说"
            hint="输入书名或作者，选中后可以按全部 / 前 20 章 / 自定义范围下载。正文不登录也能下。"
          />
        </div>
      )}

      {loadingBook && !book && (
        <div className="card p-8 flex flex-col items-center gap-2 text-[12.5px] text-on-surface-2">
          <RefreshCw size={18} className="animate-spin text-primary" />
          正在打开书籍…
        </div>
      )}

      {book && (
        <>
          {results && results.length > 1 && (
            <button
              type="button"
              onClick={backToResults}
              className="inline-flex w-fit items-center gap-1 text-[12.5px] text-primary hover:underline cursor-pointer -mb-1"
            >
              <ChevronLeft size={14} /> 返回搜索结果
            </button>
          )}

          <BookCard book={book} downloaded={downloadedIds.size} />

          <section className="card p-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold">本地进度</h2>
              <p className="text-[11.5px] text-on-surface-2 mt-1">
                已存 <span className="text-on-surface tabular-nums">{downloadedIds.size}</span> / {book.chapters.length || book.chapterCount} 章
              </p>
              {localBook?.lastError && (
                <p className="text-[11.5px] text-danger mt-1.5 leading-relaxed">上次错误：{localBook.lastError}</p>
              )}
            </div>
            <a
              href={`https://fanqienovel.com/page/${book.bookId}`}
              rel="noreferrer"
              onClick={(e) => { e.preventDefault(); openExternal(`https://fanqienovel.com/page/${book.bookId}`) }}
              className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline shrink-0"
            >
              官网页面 <ExternalLink size={12} />
            </a>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-[13.5px] font-semibold">下载范围</h2>
              <Segmented
                size="sm"
                ariaLabel="下载范围"
                value={rangeMode}
                onChange={(v) => setRangeMode(v)}
                options={[
                  { value: 'auto', label: '全部', badge: String(book.chapters.length) },
                  { value: 'first', label: '前 20 章' },
                  { value: 'custom', label: '自定义' },
                ]}
              />
            </div>

            {rangeMode === 'custom' && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-[12px] text-on-surface-2 shrink-0">从</span>
                <input
                  type="number"
                  min={1}
                  max={book.chapters.length}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  aria-label="起始章节"
                  className="w-20 h-9 px-2 rounded-[9px] bg-surface border border-outline text-[13px] outline-none focus:border-primary/60 tabular-nums"
                />
                <span className="text-[12px] text-on-surface-2 shrink-0">到</span>
                <input
                  type="number"
                  min={1}
                  max={book.chapters.length}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  aria-label="结束章节"
                  className="w-20 h-9 px-2 rounded-[9px] bg-surface border border-outline text-[13px] outline-none focus:border-primary/60 tabular-nums"
                />
                <span className="text-[11.5px] text-on-surface-2">共 {book.chapters.length} 章</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
              <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
                已选 <span className="text-on-surface font-medium tabular-nums">{selected.length}</span> 章
                {pending.length !== selected.length && (
                  <> · 已下载 <span className="tabular-nums">{selected.length - pending.length}</span> 章会跳过</>
                )}
              </p>
              <Button
                variant="primary"
                size="md"
                disabled={!pending.length || Boolean(runningOther) || runningThis}
                onClick={beginDownload}
                className="min-w-[150px]"
              >
                <Download size={16} />
                {runningThis ? '下载中…' : pending.length ? `开始下载 ${pending.length} 章` : downloadedIds.size ? '已全部下载' : '没有可下载章节'}
              </Button>
            </div>

            {runningOther && (
              <p className="text-[11.5px] text-p1 mt-2">
                《{job?.title}》正在下载，先在上面暂停它再开新任务。
              </p>
            )}

            <p className="text-[11.5px] text-on-surface-2 mt-2 leading-relaxed">
              下载中离开这一页也没关系，正文会一章一章存进本地；回来继续会跳过已下载章节。
            </p>
          </section>
        </>
      )}

      <section id="fq-library" className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13.5px] font-semibold">本地书架</h2>
          <span className="text-[11.5px] text-on-surface-2 tabular-nums">{library.length} 本</span>
        </div>
        <p className="text-[11.5px] text-on-surface-2 mt-1">正文和进度都只存本机；导出的 TXT / EPUB 存到「下载/个人工作站」，也可导入文档工作站阅读。</p>

        {library.length === 0 ? (
          <EmptyState compact icon={BookOpen} title="书架还是空的" hint="搜到书后下载正文，就会出现在这里。" />
        ) : (
          <div className="mt-2 divide-y divide-outline">
            {library.map((b) => (
              <LibraryRow
                key={b.id}
                book={b}
                busyAction={busyAction}
                onOpen={() => openLibraryBook(b)}
                onRead={() => void readBook(b)}
                onExport={(fmt) => void exportBook(b, fmt)}
                onDelete={() => setConfirmDelete(b)}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        仅用于个人离线阅读，请支持正版、不要传播下载内容。正文接口来自公开 FQWeb 节点，可能限流或临时不可用。
      </p>

      <Dialog
        open={Boolean(confirmDelete)}
        onOpenChange={(v) => { if (!v) setConfirmDelete(null) }}
        title="删除本地正文？"
        description={confirmDelete ? `《${confirmDelete.title}》的 ${confirmDelete.downloadedCount} 章正文和下载进度会一起删除，书目也会从本地书架移除。` : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(null)}>取消</Button>
          <Button variant="danger" onClick={() => void doDelete()}>
            删除
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

/* ---------------- 子组件 ---------------- */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function libraryToInfo(b: FanqieBook): FanqieBookInfo {
  return {
    bookId: b.id,
    title: b.title,
    author: b.author,
    cover: b.cover,
    abstract: b.abstract,
    status: b.status,
    statusKind: b.status.includes('完结') ? 'done' : b.status.includes('连载') ? 'serial' : 'unknown',
    wordCount: b.wordCount,
    chapterCount: b.chapterCount,
    tags: b.tags,
    lastChapterTitle: b.lastChapterTitle,
    updatedAt: b.updatedAt,
    chapters: b.chapters,
    fetchedAt: Date.now(),
    fontChanged: false,
  }
}

function searchErrorMessage(e: unknown): string {
  if (e instanceof FqwebError) {
    switch (e.code) {
      case 'SEARCH_NEEDS_PROXY':
        return e.message
      case 'NOT_FOUND':
        return '没搜到这本书，换个书名或作者试试。'
      case 'UNAVAILABLE':
        return '接口暂时连不上，稍后再试。'
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : '搜索失败'
}

function bookErrorMessage(e: unknown): string {
  if (e instanceof FqwebError) {
    if (e.code === 'UNAVAILABLE') return '正文接口暂时连不上，稍后重试。'
    if (e.code === 'NOT_FOUND') return '没有拿到这本书的目录。'
    return e.message
  }
  return e instanceof Error ? e.message : '打开书籍失败'
}

function Cover({ src, title, className }: { src?: string; title: string; className?: string }) {
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

function SearchResultCard({ item, onClick }: { item: FanqieSearchItem; onClick: () => void }) {
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
        <p className="text-[11px] text-on-surface-2 mt-1 tabular-nums">{meta || '点击查看详情'}</p>
        {item.abstract && <p className="text-[11px] text-on-surface-2 mt-1 line-clamp-2 leading-relaxed">{item.abstract}</p>}
      </div>
      <span className="self-center text-[11.5px] text-primary shrink-0">查看</span>
    </button>
  )
}

function BookCard({ book, downloaded }: { book: FanqieBookInfo; downloaded: number }) {
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

function ProgressCard({
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
        {job.phase === 'paused' && (
          <Button size="sm" variant="outline" onClick={onResume}>
            <Play size={13} /> 继续
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

function LibraryRow({
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
