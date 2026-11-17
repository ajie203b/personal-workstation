import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  List,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
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
import { isNative } from '@/lib/native'
import { formatWordCount, parseFanqieRef, type FanqieBookInfo, type FanqieChapterMeta } from '@/lib/fanqie'
import {
  fanqieWebSearchUrl,
  fetchFanqieBookById,
  fetchFanqieBookByRef,
  getCustomFqwebBase,
  getFqwebBases,
  rankFanqieSearchItems,
  searchFanqieBooks,
  setCustomFqwebBase,
  testFqwebNode,
  type FanqieSearchItem,
  type FqwebNodeTestResult,
} from '@/lib/fanqieFqweb'
import { buildFanqieEpub, buildFanqieTxt, importFanqieToDocs, sanitizeFilename, saveBlob } from '@/lib/fanqieExport'
import { openSavedAction } from '@/lib/saveFile'
import { openExternal } from '@/lib/links'
import { cn } from '@/lib/cn'
import { BookCard, LibraryRow, ProgressCard, SearchResultCard } from './fanqie/FanqieCards'
import { bookErrorMessage, clamp, libraryToInfo, searchErrorMessage } from './fanqie/fanqieHelpers'

const INITIAL_PREVIEW_LIMIT = 120

function ChapterDirectorySection({
  chapters,
  downloadedIds,
}: {
  chapters: FanqieChapterMeta[]
  downloadedIds: Set<string>
}) {
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'cached'>('all')
  const [limit, setLimit] = useState(INITIAL_PREVIEW_LIMIT)

  const filtered = useMemo(() => {
    const kw = filterText.trim().toLowerCase()
    return chapters.filter((ch) => {
      const cached = downloadedIds.has(ch.itemId)
      if (statusFilter === 'missing' && cached) return false
      if (statusFilter === 'cached' && !cached) return false
      if (!kw) return true
      return (
        ch.title.toLowerCase().includes(kw) ||
        (ch.volume ?? '').toLowerCase().includes(kw) ||
        String(ch.index).includes(kw)
      )
    })
  }, [chapters, downloadedIds, filterText, statusFilter])

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  const grouped = useMemo(() => {
    const groups: { volume: string; items: FanqieChapterMeta[] }[] = []
    for (const ch of visible) {
      const vol = ch.volume?.trim() || '正文'
      const last = groups[groups.length - 1]
      if (!last || last.volume !== vol) groups.push({ volume: vol, items: [ch] })
      else last.items.push(ch)
    }
    return groups
  }, [visible])

  return (
    <section className="card p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold">
          <List size={15} className="text-primary shrink-0" />
          章节目录预览
        </span>
        <span className="inline-flex items-center gap-2 text-[11.5px] text-on-surface-2 tabular-nums">
          <span>
            共 {chapters.length} 章 · 已缓存 {downloadedIds.size} 章
          </span>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-outline flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
              <input
                value={filterText}
                onChange={(e) => {
                  setFilterText(e.target.value)
                  setLimit(INITIAL_PREVIEW_LIMIT)
                }}
                placeholder="筛选章节名、卷名或序号…"
                aria-label="筛选章节目录"
                className="w-full h-8 pl-8 pr-3 rounded-[9px] bg-surface-2 border border-outline text-[12.5px] outline-none focus:border-primary/60"
              />
            </div>
            <Segmented
              size="sm"
              ariaLabel="目录状态筛选"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v)
                setLimit(INITIAL_PREVIEW_LIMIT)
              }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'missing', label: '未下载' },
                { value: 'cached', label: '已缓存' },
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-on-surface-2">没有符合条件的章节</p>
          ) : (
            <div className="max-h-[340px] overflow-y-auto overscroll-contain rounded-[10px] border border-outline bg-surface-2/40 divide-y divide-outline">
              {grouped.map((g, gi) => (
                <div key={`${g.volume}-${gi}`}>
                  <div className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm px-3 py-1.5 text-[11.5px] font-semibold text-on-surface-2 border-b border-outline/60">
                    {g.volume}
                  </div>
                  <ul className="divide-y divide-outline/60">
                    {g.items.map((ch) => {
                      const cached = downloadedIds.has(ch.itemId)
                      return (
                        <li key={ch.itemId} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                          <span className="text-[11px] text-on-surface-2 tabular-nums w-10 shrink-0">#{ch.index}</span>
                          <span className="min-w-0 flex-1 truncate">{ch.title}</span>
                          {ch.locked && (
                            <span title="官网标记锁定（FQWeb 节点通常可正常获取）" className="text-on-surface-2 shrink-0">
                              <Lock size={12} />
                            </span>
                          )}
                          {ch.wordCount ? (
                            <span className="hidden sm:inline text-[11px] text-on-surface-2 tabular-nums shrink-0">
                              {formatWordCount(ch.wordCount)}
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded-[5px] text-[10.5px] font-medium shrink-0',
                              cached ? 'bg-ok/10 text-ok' : 'bg-surface-3 text-on-surface-2',
                            )}
                          >
                            {cached ? '已缓存' : '未下载'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {filtered.length > visible.length && (
            <div className="flex items-center justify-between text-[11.5px] text-on-surface-2">
              <span>当前显示前 {visible.length} / {filtered.length} 章</span>
              <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + 200)}>
                再展开 200 章
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

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

  const [showNodes, setShowNodes] = useState(false)
  const [customNodeInput, setCustomNodeInput] = useState(() => getCustomFqwebBase())
  const [savedCustomNode, setSavedCustomNode] = useState(() => getCustomFqwebBase())
  const [testingNode, setTestingNode] = useState(false)
  const [nodeTestResult, setNodeTestResult] = useState<FqwebNodeTestResult | null>(null)

  const saveLocationText = isNative() ? '「下载/个人工作站」' : '浏览器默认下载目录'

  const libraryRows = useLiveQuery(() => listFanqieBooks(), [])
  const library = useMemo(() => libraryRows ?? [], [libraryRows])

  const shelfMatches = useMemo(() => {
    const keyword = query.trim()
    if (!keyword) return []
    const ref = parseFanqieRef(keyword)
    const onlineIds = new Set(results?.map(({ bookId }) => bookId))
    if (ref && (ref.kind === 'book' || ref.kind === 'auto')) {
      return library
        .filter(({ id }) => id === ref.id && !onlineIds.has(id))
        .map(({ id, title, author, cover, status, chapterCount }) => ({
          bookId: id, title, author, cover, status, chapterCount,
        }))
    }
    if (keyword.length < 2 || ref) return []
    const items = library
      .filter(({ id }) => !onlineIds.has(id))
      .map(({ id, title, author, cover, status, chapterCount }) => ({
        bookId: id, title, author, cover, status, chapterCount,
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

  const rangeCalc = useMemo(() => {
    if (!book || !book.chapters.length) {
      return { selected: [] as FanqieChapterMeta[], swapped: false, outOfBounds: false, startIdx: 1, endIdx: 0 }
    }
    const max = book.chapters.length
    if (rangeMode === 'first') {
      return { selected: book.chapters.slice(0, 20), swapped: false, outOfBounds: false, startIdx: 1, endIdx: Math.min(20, max) }
    }
    if (rangeMode === 'custom') {
      const fromNum = Number(from)
      const toNum = Number(to)
      const hasFrom = from.trim() !== '' && Number.isFinite(fromNum)
      const hasTo = to.trim() !== '' && Number.isFinite(toNum)
      const rawA = clamp(hasFrom ? Math.floor(fromNum) : 1, 1, max)
      const rawB = clamp(hasTo ? Math.floor(toNum) : max, 1, max)
      const swapped = hasFrom && hasTo && rawA > rawB
      const outOfBounds = (hasFrom && (fromNum < 1 || fromNum > max)) || (hasTo && (toNum < 1 || toNum > max))
      const startIdx = Math.min(rawA, rawB)
      const endIdx = Math.max(rawA, rawB)
      return { selected: book.chapters.slice(startIdx - 1, endIdx), swapped, outOfBounds, startIdx, endIdx }
    }
    return { selected: book.chapters, swapped: false, outOfBounds: false, startIdx: 1, endIdx: max }
  }, [book, rangeMode, from, to])

  const selected = rangeCalc.selected
  const pending = selected.filter((c) => !downloadedIds.has(c.itemId))
  const allBookMissingCount = book ? book.chapters.filter((c) => !downloadedIds.has(c.itemId)).length : 0
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

  const startDownloadFor = (targetBook: FanqieBookInfo, chapters: FanqieChapterMeta[]) => {
    if (!chapters.length) return
    if (job?.phase === 'running' && job.bookId !== targetBook.bookId) {
      toast('另一个下载任务还在进行，先暂停它')
      return
    }
    void start(targetBook, chapters).catch((e) => {
      toast(e instanceof Error ? e.message : '启动下载失败')
    })
  }

  const beginDownload = () => {
    if (!book || !pending.length) return
    startDownloadFor(book, selected)
  }

  const resumeMissingBook = (targetBook: FanqieBookInfo) => {
    if (!targetBook.chapters.length) return
    startDownloadFor(targetBook, targetBook.chapters)
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

  const saveCustomNode = () => {
    try {
      const next = setCustomFqwebBase(customNodeInput)
      setCustomNodeInput(next)
      setSavedCustomNode(next)
      setNodeTestResult(null)
      toast(next ? `已保存自定义节点：${next}` : '已清除自定义节点，使用默认节点')
    } catch (e) {
      toast(e instanceof Error ? e.message : '节点地址无效')
    }
  }

  const clearCustomNode = () => {
    setCustomNodeInput('')
    setCustomFqwebBase('')
    setSavedCustomNode('')
    setNodeTestResult(null)
    toast('已恢复默认 FQWeb 节点')
  }

  const runNodeTest = async () => {
    if (testingNode) return
    setTestingNode(true)
    setNodeTestResult(null)
    try {
      const res = await testFqwebNode(customNodeInput.trim() || undefined)
      setNodeTestResult(res)
    } catch (e) {
      setNodeTestResult({
        ok: false,
        base: customNodeInput.trim(),
        latencyMs: 0,
        message: e instanceof Error ? e.message : '节点测试失败',
      })
    } finally {
      setTestingNode(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolNovel size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="hidden md:block text-[22px] font-bold leading-7">番茄小说</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            搜书名 / 作者，下载全本到本地书架 · TXT / EPUB
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={showNodes}
          onClick={() => setShowNodes((v) => !v)}
          className="shrink-0"
        >
          <Server size={14} />
          书源节点{savedCustomNode ? ' · 自定义' : ''}
        </Button>
      </header>

      {showNodes && (
        <section className="card p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-[13px] font-semibold">自定义 FQWeb 节点</h2>
            <span className="text-[11px] text-on-surface-2">默认：{getFqwebBases().join(' → ')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={customNodeInput}
              onChange={(e) => setCustomNodeInput(e.target.value)}
              placeholder="例如 https://your-fqweb-node.example.com"
              aria-label="自定义 FQWeb 节点地址"
              className="h-9 min-w-[200px] flex-1 rounded-[9px] border border-outline bg-surface px-3 text-[13px] outline-none focus:border-primary/60"
            />
            <Button size="sm" variant="primary" onClick={saveCustomNode} className="shrink-0">
              保存节点
            </Button>
            {savedCustomNode && (
              <Button size="sm" variant="ghost" onClick={clearCustomNode} className="shrink-0">
                清除
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              state={testingNode ? 'loading' : 'idle'}
              onClick={() => void runNodeTest()}
              className="shrink-0"
            >
              测试连通性
            </Button>
          </div>
          {nodeTestResult && (
            <p
              role="status"
              className={cn(
                'inline-flex items-center gap-1.5 text-[12px] leading-relaxed',
                nodeTestResult.ok ? 'text-ok' : 'text-danger',
              )}
            >
              {nodeTestResult.ok ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
              <span className="break-all">
                {nodeTestResult.base ? `${nodeTestResult.base}：` : ''}
                {nodeTestResult.message}
              </span>
            </p>
          )}
          <p className="text-[11px] text-on-surface-2 leading-relaxed">
            优先尝试自定义节点，其次官方公共 FQWeb 节点；若全部不可用，将自动回退到番茄小说官方网页解析。
          </p>
        </section>
      )}

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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-[1_1_12rem]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
            <input
              id="fq-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：戏神 / 三九音域"
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
              <SearchResultCard
                key={item.bookId}
                item={item}
                onClick={() => {
                  const entry = library.find(({ id }) => id === item.bookId)
                  if (entry) openLibraryBook(entry)
                }}
              />
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

          <BookCard
            book={book}
            downloaded={downloadedIds.size}
            lastError={localBook?.lastError}
            resumeDisabled={Boolean(runningOther) || runningThis}
            onResumeMissing={() => resumeMissingBook(book)}
          />

          <section className="card p-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold">本地进度</h2>
              <p className="text-[11.5px] text-on-surface-2 mt-1">
                已存 <span className="text-on-surface tabular-nums">{downloadedIds.size}</span> / {book.chapters.length || book.chapterCount} 章
              </p>
              {allBookMissingCount > 0 && downloadedIds.size > 0 && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(runningOther) || runningThis}
                    onClick={() => resumeMissingBook(book)}
                  >
                    <RotateCcw size={13} /> 续传缺失章节（{allBookMissingCount}）
                  </Button>
                </div>
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
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
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
                {rangeCalc.swapped && (
                  <p className="text-[11.5px] text-p1">
                    起始章大于结束章，已自动调整为第 {rangeCalc.startIdx} – {rangeCalc.endIdx} 章
                  </p>
                )}
                {rangeCalc.outOfBounds && (
                  <p className="text-[11.5px] text-on-surface-2">
                    有效范围为 1 – {book.chapters.length}，超出部分已自动限制
                  </p>
                )}
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
                className="min-w-[150px] shrink-0"
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

          {book.chapters.length > 0 && (
            <ChapterDirectorySection chapters={book.chapters} downloadedIds={downloadedIds} />
          )}
        </>
      )}

      <section id="fq-library" className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13.5px] font-semibold">本地书架</h2>
          <span className="text-[11.5px] text-on-surface-2 tabular-nums">{library.length} 本</span>
        </div>
        <p className="text-[11.5px] text-on-surface-2 mt-1">
          正文和进度都只存本机；导出的 TXT / EPUB 存到{saveLocationText}，也可导入文档工作站阅读。
        </p>

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
                onResume={
                  b.chapters.length > 0 && b.downloadedCount < b.chapterCount
                    ? () => resumeMissingBook(libraryToInfo(b))
                    : undefined
                }
                onDelete={() => setConfirmDelete(b)}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        仅用于个人离线阅读，请支持正版、不要传播下载内容。正文接口来自公开 FQWeb 节点（支持自定义节点），失败时回退官网页面，可能限流或临时不可用。
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
