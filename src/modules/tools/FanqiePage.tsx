import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
} from 'lucide-react'
import { IconToolNovel } from '@/shared/icons'
import { Button } from '@/shared/ui/Button'
import { BackButton } from '@/shared/ui/BackButton'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { useFanqie } from '@/stores/fanqie'
import { deleteFanqieBook, getDownloadedItemIds, getFanqieBook, getFanqieChapterRows, listFanqieBooks } from '@/db/fanqie'
import type { FanqieBook } from '@/db/db'
import { parseFanqieRef, type FanqieBookInfo } from '@/lib/fanqie'
import {
  fanqieWebSearchUrl,
  fetchFanqieBookById,
  fetchFanqieBookByRef,
  rankFanqieSearchItems,
  searchFanqieBooks,
  type FanqieSearchItem,
} from '@/lib/fanqieFqweb'
import { buildFanqieEpub, buildFanqieTxt, importFanqieToDocs, sanitizeFilename, saveBlob } from '@/lib/fanqieExport'
import { openSavedAction } from '@/lib/saveFile'
import { openExternal } from '@/lib/links'
import { BookCard, LibraryRow, ProgressCard, SearchResultCard } from './fanqie/FanqieCards'
import { bookErrorMessage, clamp, libraryToInfo, searchErrorMessage } from './fanqie/fanqieHelpers'

export function FanqiePage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const job = useFanqie((s) => s.job)
  const start = useFanqie((s) => s.start)
  const pause = useFanqie((s) => s.pause)
  const resume = useFanqie((s) => s.resume)
  const clearJob = useFanqie((s) => s.clear)

  const [query, setQuery] = useState('')
  const [searchedKeyword, setSearchedKeyword] = useState('')
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

  const libraryRows = useLiveQuery(() => listFanqieBooks(), [])
  const library = useMemo(() => libraryRows ?? [], [libraryRows])
  const shelfMatches = useMemo(() => {
    const keyword = query.trim()
    if (keyword.length < 2 || parseFanqieRef(keyword)) return []
    const onlineIds = new Set(results?.map(({ bookId }) => bookId))
    const items = library.filter(({ id }) => !onlineIds.has(id)).map(({ id, title, author, cover, status }) => ({
      bookId: id, title, author, cover, status,
    }))
    return rankFanqieSearchItems(keyword, items, true).slice(0, 4)
  }, [library, query, results])
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
  const webSearchUrl = searchedKeyword ? fanqieWebSearchUrl(searchedKeyword) : ''

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
    setSearchedKeyword(ref ? '' : q)
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
      const items = await searchFanqieBooks(q, setResults)
      setResults(items)
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
    setSearchedKeyword('')
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
      toast(`已导出 ${format.toUpperCase()}（${rows.length} 章）→ ${where}`, openSavedAction())
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
          <IconToolNovel size={22} />
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
              placeholder="例如：戏神、三九音域、番茄书籍链接"
              aria-describedby="fq-search-hint"
              enterKeyHint="search"
              className="w-full h-10 pl-9 pr-3 rounded-[10px] bg-surface border border-outline text-[13.5px] outline-none focus:border-primary/60 placeholder:text-on-surface-2/70"
            />
          </div>
          <Button type="submit" variant="primary" size="md" state={busy ? 'loading' : 'idle'} className="shrink-0">
            搜索
          </Button>
        </div>
        <p id="fq-search-hint" className="text-[11.5px] text-on-surface-2 mt-2 leading-relaxed">
          支持部分书名、别名和作者，也可粘贴番茄链接或纯数字 ID。
        </p>
      </form>

      {error && (
        <div className="card p-3.5 flex items-start gap-2.5 border-danger/25">
          <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
          <p role="alert" className="text-[12.5px] leading-relaxed">{error}</p>
        </div>
      )}

      {!book && !busy && shelfMatches.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[13.5px] font-semibold">书架中的匹配</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {shelfMatches.map((item) => (
              <SearchResultCard key={item.bookId} item={item} onClick={() => {
                const entry = library.find(({ id }) => id === item.bookId)
                if (entry) openLibraryBook(entry)
              }} />
            ))}
          </div>
        </section>
      )}

      {searching && !loadingBook && !book && (
        <p role="status" className="px-1 text-[12.5px] text-on-surface-2">
          {results?.length ? '正在查找更多书籍…' : '正在查找书籍…'}
        </p>
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
          <EmptyState compact icon={Search} title="在线书源暂未搜到相关书籍" hint="可以换一段书名，或用作者名查找作品。" />
        </div>
      )}

      {!book && !busy && webSearchUrl && (results || error) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <a
            href={webSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); openExternal(webSearchUrl) }}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-primary hover:underline"
          >
            <ExternalLink size={14} aria-hidden /> 去浏览器找书
          </a>
          <p className="text-[11.5px] text-on-surface-2">找到后，将番茄书籍详情页链接粘贴到搜索框。</p>
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
          {results && results.length > 0 && (
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
