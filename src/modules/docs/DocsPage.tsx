import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { FolderOpen, FolderPlus, Import, LayoutGrid, MoreHorizontal, PenLine, Plus, Search, Settings2, SlidersHorizontal, Sparkles, Table2, Trash2 } from 'lucide-react'
import { isTauri } from '@/lib/native'
import { IconDocs } from '@/shared/icons'
import { DOC_KIND_LABEL, type Annotation, type Doc, type DocKind, type DocReadStatus, type Folder } from '@/db/db'
import { deleteDoc, getDocBlob, importDoc, updateDocMeta } from '@/db/docs'
import { readDocumentText } from '@/lib/readDocumentText'
import { shareMarkdown } from '@/lib/shareDoc'
import { createFolder, deleteFolder, setDocFolder } from '@/db/folders'
import { useDocsLive } from '@/db/hooks'
import { DocCardSkeleton } from '@/shared/ui/Skeleton'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { docPath, docHitPath } from '@/shared/DeepLink'
import { backfillDocTextIndex } from '@/lib/docTextIndex'
import { morphOpen } from '@/lib/viewTransition'
import { DocDragWorkspace, DocDragItem, TRASH_FOLDER, UNFILED_FOLDER } from './DocDrag'
import { DocTrash } from './DocTrash'
import { FolderStripMobile, FolderTree } from './DocsFolderNav'
import { DocCard, ImportingCard } from './DocsCards'
import { DocsTable } from './DocsTable'
import { DocsDialogs, type FolderDialogState } from './DocsDialogs'
import { AnnotationReviewDialog } from './AnnotationReviewDialog'
import { CitationDialog } from './CitationDialog'
import { Sheet } from '@/shared/ui/Sheet'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem } from '@/shared/ui/Menu'
import { useFocusActive } from '@/shared/FocusMiniBar'
import { isAnnotationDue } from './reviewSm2'
import {
  ANNOTATED_VIEW,
  RECENT_VIEW,
  STARRED_VIEW,
  filterAndSortDocs,
  type DocSortKey,
} from './libraryModel'

const DESKTOP_DOCS = '(min-width: 1024px)'
function subscribeToWidth(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_DOCS)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const isDesktopWidth = () => window.matchMedia(DESKTOP_DOCS).matches

/** 文档工作站 · 文档库（三栏工作区的入口） */
export function DocsPage() {
  const navigate = useNavigate()
  const docsLive = useDocsLive()
  const docs = useMemo(() => docsLive ?? [], [docsLive])
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [citationDoc, setCitationDoc] = useState<Doc | null>(null)
  const desktop = useSyncExternalStore(subscribeToWidth, isDesktopWidth)
  const focusActive = useFocusActive()
  const activeFolder = params.get('folder')
  const inTrash = activeFolder === TRASH_FOLDER
  const trashCount = useLiveQuery(() => db.docs.filter(d => !!d.deletedAt).count(), [], 0)
  const folders = useLiveQuery(() => db.folders.toArray(), [], [] as Folder[])
  const allAnnotations = useLiveQuery(() => db.annotations.toArray(), [], [] as Annotation[])
  const annCountByHash = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of allAnnotations) m[a.docHash] = (m[a.docHash] ?? 0) + 1
    return m
  }, [allAnnotations])
  const folderCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of docs) if (d.folderId) m[d.folderId] = (m[d.folderId] ?? 0) + 1
    return m
  }, [docs])
  const uncategorizedCount = useMemo(() => docs.filter((d) => !d.folderId).length, [docs])
  const starredCount = useMemo(() => docs.filter((d) => !!d.starred).length, [docs])
  const recentCount = useMemo(() => docs.filter((d) => !!d.lastOpenedAt).length, [docs])
  const annotatedCount = useMemo(() => docs.filter((d) => (annCountByHash[d.hash] ?? 0) > 0).length, [docs, annCountByHash])
  const allTags = useMemo(() => [...new Set(docs.flatMap((d) => d.tags ?? []))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [docs])
  const dueReviewCount = useMemo(() => {
    const hashes = new Set(docs.map((d) => d.hash))
    return allAnnotations.filter((a) => hashes.has(a.docHash) && isAnnotationDue(a)).length
  }, [docs, allAnnotations])

  const [kindFilter, setKindFilter] = useState<DocKind | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<DocReadStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [sortBy, setSortBy] = useState<DocSortKey>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try {
      return localStorage.getItem('docs:viewMode') === 'table' ? 'table' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null)
  const [folderName, setFolderName] = useState('')
  const [folderParentId, setFolderParentId] = useState('')
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null)
  const [metaDoc, setMetaDoc] = useState<Doc | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const toast = useUi((s) => s.toast)
  const [keyword, setKeyword] = useState('')
  // 搜索防抖：全文命中要扫所有 docText，逐字符触发会把主线程按住（文档库卡死的直接来源）
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(keyword), 250)
    return () => clearTimeout(t)
  }, [keyword])
  const [pendingDelete, setPendingDelete] = useState<Doc | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** 全文搜索用小写副本缓存（hash → {indexedAt, lower}），避免每次改关键词都整篇 toLowerCase */
  const lowerCache = useRef(new Map<string, { at: number; lower: string }>())

  const progressMap = useLiveQuery(
    async () => {
      const all = await db.positions.toArray()
      return Object.fromEntries(all.map((p) => [p.hash, p]))
    },
    [],
    {} as Record<string, { progressPct?: number; updatedAt: number }>,
  )

  // 全文索引：进入页面静默回填，一次一篇、篇间让出主线程。
  // 原来一轮 5 篇接一轮地跑，手机上等于连续几十秒的满负载，表现就是「点到文档工作站就卡死」。
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (!alive) return
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, 3000)
        return
      }
      try {
        const n = await backfillDocTextIndex(1)
        timer = setTimeout(tick, n > 0 ? 400 : 5000)
      } catch {
        timer = setTimeout(tick, 5000)
      }
    }
    timer = setTimeout(tick, 1200)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  const textHits = useLiveQuery(async () => {
    const kw = query.trim().toLowerCase()
    if (!kw || kw.length < 2) return {}
    const rows = await db.docText.toArray()
    const map: Record<string, { count: number; snippet: string; seg?: number }> = {}
    for (const r of rows) {
      let entry = lowerCache.current.get(r.hash)
      if (!entry || entry.at !== r.indexedAt) {
        entry = { at: r.indexedAt, lower: r.text.toLowerCase() }
        lowerCache.current.set(r.hash, entry)
      }
      const lower = entry.lower
      const idx = lower.indexOf(kw)
      if (idx === -1) continue
      let count = 0
      let pos = idx
      while (pos !== -1 && count < 500) { count++; pos = lower.indexOf(kw, pos + kw.length) }
      let seg: number | undefined
      if (r.segments?.length) {
        let acc = 0
        for (let i = 0; i < r.segments.length; i++) {
          acc += r.segments[i].length + 1
          if (acc > idx) { seg = i + 1; break }
        }
      }
      const start = Math.max(0, idx - 24)
      const snippet = (start > 0 ? '…' : '') + r.text.slice(start, idx + kw.length + 56).replace(/\s+/g, ' ') + '…'
      map[r.hash] = { count, snippet, seg }
    }
    return map
  }, [query], {} as Record<string, { count: number; snippet: string; seg?: number }>)

  const visibleDocs = useMemo(
    () => filterAndSortDocs({
      docs,
      view: activeFolder,
      folders,
      kindFilter,
      statusFilter,
      tagFilter,
      annCountByHash,
      progressMap,
      sortBy,
      query,
      textHits,
    }),
    [docs, activeFolder, folders, kindFilter, statusFilter, tagFilter, annCountByHash, progressMap, sortBy, query, textHits],
  )

  const openCreateFolder = (parentId?: string) => {
    setFolderName('')
    setFolderParentId(parentId ?? (folders.some((f) => f.id === activeFolder) ? activeFolder ?? '' : ''))
    setFolderDialog({ mode: 'create', parentId })
  }

  const toggleStar = (doc: Doc) => {
    void updateDocMeta(doc.id, { starred: !doc.starred })
  }

  const switchViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode)
    try { localStorage.setItem('docs:viewMode', mode) } catch { /* ignore */ }
  }

  /** 当前筛选的文件夹或智能视图；null = 全部文档 */
  function setFolderParam(id: string | null) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id) next.set('folder', id)
      else next.delete('folder')
      return next
    }, { replace: true })
  }

  async function doCreateFolder() {
    const name = folderName.trim()
    if (!name) return
    const f = await createFolder(name, undefined, folderParentId || undefined)
    setFolderDialog(null)
    setFolderParam(f.id)
    toast(`已创建「${f.name}」`)
  }

  const { state: importState, run: runImport } = useAsyncButton({ successHoldMs: 900 })

  /** 正在导入的文件：卡片先出现，进度在卡片上走（大 PDF 算指纹要好几百毫秒） */
  const [pending, setPending] = useState<{ id: string; name: string; at: number }[]>([])

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return
    let added = 0
    let dup = 0
    let failed = 0
    const list = Array.from(files)
    const jobs = list.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, at: Date.now() }))
    setPending(jobs)
    const targetFolderId = activeFolder && folders.some((f) => f.id === activeFolder) ? activeFolder : undefined
    try {
      await runImport(async () => {
        for (const [i, file] of list.entries()) {
          const jobId = jobs[i].id
          try {
            const r = await importDoc(file)
            if (targetFolderId && !r.duplicated) await setDocFolder(r.doc.id, targetFolderId)
            else if (activeFolder === STARRED_VIEW && !r.duplicated) await updateDocMeta(r.doc.id, { starred: true })
            if (r.duplicated) dup++
            else added++
          } catch {
            failed++
            toast(`「${file.name}」导入失败`)
          } finally {
            setPending((p) => p.filter((x) => x.id !== jobId))
          }
        }
        if (added) toast(`已导入 ${added} 个文档${dup ? `，${dup} 个重复已跳过` : ''}`)
        else if (dup) toast('文档已存在（内容相同），无需重复导入')
        if (!added && failed) throw new Error('导入失败')
      })
    } catch {
      /* 失败态已由按钮呈现 */
    } finally {
      setPending([])
    }
  }

  const hasFilters = kindFilter !== 'all' || statusFilter !== 'all' || !!tagFilter || !!query.trim()
  const isUserFolder = folders.some((f) => f.id === activeFolder)
  const hasOptions = kindFilter !== 'all' || statusFilter !== 'all' || !!tagFilter || sortBy !== 'recent'
  const requestFolderDelete = () => setFolderToDelete(folders.find((f) => f.id === activeFolder) ?? null)

  const filters = (compact: boolean) => (
    <div className={compact ? "grid gap-3 [&_select]:h-11 [&_select]:w-full" : "flex flex-wrap items-center gap-2 text-[12px]"}>
      <select
        aria-label="按格式筛选"
        value={kindFilter}
        onChange={(e) => setKindFilter(e.target.value as DocKind | 'all')}
        className="h-8 px-2.5 rounded-[9px] bg-surface-2 border border-outline text-on-surface outline-none focus:border-primary/60 cursor-pointer"
      >
        <option value="all">全部格式</option>
        {(Object.keys(DOC_KIND_LABEL) as DocKind[]).map((k) => (
          <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>
        ))}
      </select>
      <select
        aria-label="按阅读状态筛选"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as DocReadStatus | 'all')}
        className="h-8 px-2.5 rounded-[9px] bg-surface-2 border border-outline text-on-surface outline-none focus:border-primary/60 cursor-pointer"
      >
        <option value="all">全部状态</option>
        <option value="unread">未读</option>
        <option value="reading">在读</option>
        <option value="done">已读</option>
      </select>
      {(compact || allTags.length > 0) && (
        <select
          aria-label="按标签筛选"
          disabled={!allTags.length}
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="h-8 px-2.5 rounded-[9px] bg-surface-2 border border-outline text-on-surface outline-none focus:border-primary/60 cursor-pointer"
        >
          <option value="">全部标签</option>
          {allTags.map((t) => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>
      )}
      {(hasOptions || (!compact && hasFilters)) && (
        <button
          type="button"
          onClick={() => { setKindFilter('all'); setStatusFilter('all'); setTagFilter(''); setSortBy('recent'); if (!compact) setKeyword('') }}
          className="h-8 px-2.5 rounded-[9px] text-primary hover:bg-primary-soft cursor-pointer"
        >
          重置筛选
        </button>
      )}
      <div className={compact ? "" : "ml-auto flex items-center gap-2"}>
        <select
          aria-label="排序方式"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as DocSortKey)}
          className="h-8 px-2.5 rounded-[9px] bg-surface-2 border border-outline text-on-surface outline-none focus:border-primary/60 cursor-pointer"
        >
          <option value="recent">最近打开</option>
          <option value="added">添加时间</option>
          <option value="title">标题 A-Z</option>
          <option value="progress">阅读进度</option>
          <option value="annotations">批注最多</option>
        </select>
        {desktop && <div className="inline-flex rounded-[9px] border border-outline bg-surface-2 p-0.5" role="group" aria-label="视图切换">
          <button
            type="button"
            aria-label="卡片视图"
            title="卡片视图"
            onClick={() => switchViewMode('grid')}
            className={`grid place-items-center w-7 h-7 rounded-[7px] cursor-pointer ${viewMode === 'grid' ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:text-on-surface'}`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            aria-label="文献表格视图"
            title="文献表格视图"
            onClick={() => switchViewMode('table')}
            className={`grid place-items-center w-7 h-7 rounded-[7px] cursor-pointer ${viewMode === 'table' ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:text-on-surface'}`}
          >
            <Table2 size={14} />
          </button>
        </div>}
      </div>
    </div>
  )

  return (
    <DocDragWorkspace docs={docs} onDrop={async (doc, target) => {
      try {
        if (target === TRASH_FOLDER) { await deleteDoc(doc); toast('已移入回收站') }
        else if (target === UNFILED_FOLDER || folders.some(f => f.id === target)) {
          await setDocFolder(doc.id, target === UNFILED_FOLDER ? undefined : target)
          toast(target === UNFILED_FOLDER ? '已移回未分类' : '已移动到文件夹')
        }
      } catch { toast('移动失败，请重试') }
    }}>
    <div className="mx-auto w-full max-w-[1500px] px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 cascade">
      {/* 桌面：标题 + 搜索 / 写作 / 导入 一行放得下 */}
      <div className="hidden lg:flex lg:items-start gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-8">文档工作站</h1>
          <p className="text-[13px] text-on-surface-2 mt-0.5">本地优先 · 文献分类与引文 · 划词截图与间隔复习</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题、作者、标签或全文…"
            aria-label="搜索文档"
            className="h-9 w-56 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
          />
          {allAnnotations.length > 0 && (
            <Button size="sm" onClick={() => setReviewOpen(true)}>
              <Sparkles size={14} /> 批注复习
              {dueReviewCount > 0 && <span className="ml-0.5 px-1.5 rounded-full bg-primary-soft text-primary text-[11px] tabular-nums">{dueReviewCount}</span>}
            </Button>
          )}
          {isTauri() && <Button size="sm" onClick={() => navigate('/local-markdown')}><FolderOpen size={15} /> 本地文档</Button>}
          <Button size="sm" onClick={() => navigate('/docs/new')}>
            <PenLine size={15} /> 写文档
          </Button>
          <Button variant="primary" size="sm" state={importState} onClick={() => fileRef.current?.click()}>
            <Import size={15} /> 导入
          </Button>
        </div>
      </div>

      {/* 手机：常用入口直接展示，搜索框随剩余宽度收缩。 */}
      <div className="lg:hidden flex items-center gap-2 pt-[env(safe-area-inset-top)]">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标题、作者或全文…"
          aria-label="搜索文档"
          className="flex-1 min-w-0 h-11 px-3 rounded-[10px] bg-surface-2 border border-outline text-[16px] outline-none focus:border-primary/60"
        />
        {!inTrash && (
          <button type="button" aria-label="筛选文档" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}
            className="relative grid place-items-center shrink-0 w-11 h-11 rounded-[10px] border border-outline bg-surface-2 text-on-surface cursor-pointer">
            <SlidersHorizontal size={18} />
            {hasOptions && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="更多文档操作" className="grid place-items-center shrink-0 w-11 h-11 rounded-[10px] text-on-surface-2 hover:bg-surface-2 cursor-pointer">
              <MoreHorizontal size={20} />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => openCreateFolder()}><FolderPlus size={16} />新建文件夹</MenuItem>
            {isUserFolder && <MenuItem onSelect={requestFolderDelete}><Trash2 size={16} />删除文件夹</MenuItem>}
            {isTauri() && <MenuItem onSelect={() => navigate('/local-markdown')}><FolderOpen size={16} />本地文档</MenuItem>}
            {allAnnotations.length > 0 && <MenuItem onSelect={() => setReviewOpen(true)}><Sparkles size={16} />批注复习{dueReviewCount > 0 ? ` (${dueReviewCount})` : ''}</MenuItem>}
            <MenuItem active={inTrash} onSelect={() => setFolderParam(TRASH_FOLDER)}><Trash2 size={16} />回收站{trashCount > 0 ? ` (${trashCount})` : ''}</MenuItem>
            <MenuItem onSelect={() => navigate('/settings')}><Settings2 size={16} />设置</MenuItem>
          </MenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-start gap-5">
        <FolderTree
          folders={folders}
          counts={folderCounts}
          allCount={docs.length}
          starredCount={starredCount}
          recentCount={recentCount}
          annotatedCount={annotatedCount}
          uncategorizedCount={uncategorizedCount}
          trashCount={trashCount}
          active={activeFolder}
          onPick={setFolderParam}
          onCreate={(pid) => openCreateFolder(pid)}
          onDelete={requestFolderDelete}
        />

        <div className="flex-1 min-w-0 flex flex-col gap-3.5">
          <FolderStripMobile
            folders={folders}
            counts={folderCounts}
            allCount={docs.length}
            starredCount={starredCount}
            recentCount={recentCount}
            annotatedCount={annotatedCount}
            uncategorizedCount={uncategorizedCount}
            activeFolder={activeFolder}
            onPick={setFolderParam}
          />

          {inTrash ? <><Button size="sm" className="self-start" onClick={() => setFolderParam(null)}>返回全部</Button><DocTrash /></> : <>
          {desktop && docs.length > 0 && filters(false)}

          {pending.length > 0 && (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
              {pending.map((p) => <ImportingCard key={p.id} name={p.name} at={p.at} />)}
            </div>
          )}

          {docsLive === undefined ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
              {Array.from({ length: 6 }).map((_, i) => <DocCardSkeleton key={i} />)}
            </div>
          ) : docs.length === 0 && pending.length === 0 && !isUserFolder ? (
            <EmptyState
              icon={IconDocs}
              title="文档库还是空的"
              hint="导入 PDF / EPUB / Word / PPT / Markdown / TXT，或直接用编辑器写一篇。支持划词高亮、批注转任务、关掉重开自动回到上次位置。"
            >
              <div className="flex gap-2 justify-center">
                <Button variant="primary" size="sm" className="rounded-[9px]" onClick={() => navigate('/docs/new')}>
                  <PenLine size={15} /> 写文档
                </Button>
                <Button variant="outline" size="sm" className="rounded-[9px]" onClick={() => fileRef.current?.click()}>
                  <Import size={15} /> 选择文件
                </Button>
              </div>
            </EmptyState>
          ) : visibleDocs.length === 0 ? (
            hasFilters ? (
              <EmptyState icon={Search} title="没有匹配的文档" hint="调整格式/状态/标签筛选，或换个关键词试试（全文搜索需 2 个字符以上）。" />
            ) : (
              <EmptyState
                icon={IconDocs}
                title={
                  isUserFolder
                    ? '这个文件夹还是空的'
                    : activeFolder === STARRED_VIEW
                      ? '还没有星标文档'
                      : activeFolder === RECENT_VIEW
                        ? '还没有阅读记录'
                        : activeFolder === ANNOTATED_VIEW
                          ? '还没有带批注的文档'
                          : '没有未分类的文档'
                }
                hint={isUserFolder
                  ? desktop ? '把文档拖进此文件夹，或在这里直接导入。' : '选择要放入此文件夹的文件。'
                  : '给文档加星标或做批注后，会出现在相应分类。'}
              >
                {isUserFolder && <Button variant="primary" size="sm" state={importState} onClick={() => fileRef.current?.click()}><Import size={15} />导入到此文件夹</Button>}
              </EmptyState>
            )
          ) : desktop && viewMode === 'table' ? (
            <DocsTable
              rows={visibleDocs.map((d) => ({
                doc: d,
                hit: keyword.trim().length >= 2 ? textHits[d.hash] : undefined,
              }))}
              folders={folders}
              progressMap={progressMap}
              annCountByHash={annCountByHash}
              onOpen={(d, hit) =>
                morphOpen(
                  () => document.getElementById(`doc-${d.id}`),
                  () => navigate(hit ? docHitPath(d, hit.seg, query.trim()) : docPath({ docId: d.id })),
                )
              }
              onRead={(d) => navigate(docPath({ docId: d.id }))}
              onEdit={(d) => navigate(`/docs/edit/${d.id}`)}
              onShare={(d) => {
                void getDocBlob(d.hash).then(async (blob) => {
                  if (!blob) { toast('文件本体没找到，可能被系统清理了'); return }
                  const msg = await shareMarkdown(d.title, await readDocumentText(blob))
                  if (msg) toast(msg)
                }).catch(() => toast('分享失败，请重试'))
              }}
              onMove={(d) => { setFolderName(''); setFolderDialog({ mode: 'move', doc: d }) }}
              onToggleStar={toggleStar}
              onEditMeta={(d) => setMetaDoc(d)}
              onOpenCitation={setCitationDoc}
              onRequestConfirm={(d) => setPendingDelete(d)}
            />
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
              {visibleDocs.map((d) => {
                const hit = keyword.trim().length >= 2 ? textHits[d.hash] : undefined
                return (
                  <DocDragItem key={d.id} doc={d}><DocCard
                    doc={d}
                    pct={Math.round((progressMap[d.hash]?.progressPct ?? 0) * 100)}
                    hit={hit}
                    onOpen={() =>
                      morphOpen(
                        () => document.getElementById(`doc-${d.id}`),
                        () => navigate(hit ? docHitPath(d, hit.seg, query.trim()) : docPath({ docId: d.id })),
                      )
                    }
                    onRead={() => navigate(docPath({ docId: d.id }))}
                    onToggleStar={() => toggleStar(d)}
                    onEditMeta={() => setMetaDoc(d)}
                    onOpenCitation={() => setCitationDoc(d)}
                    onMove={() => { setFolderName(''); setFolderDialog({ mode: 'move', doc: d }) }}
                    onRequestConfirm={() => setPendingDelete(d)}
                  /></DocDragItem>
                )
              })}
            </div>
          )}
          </>}
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="筛选文档">
        {filters(true)}
      </Sheet>
      {citationDoc && <CitationDialog doc={citationDoc} onClose={() => setCitationDoc(null)} />}
      {!inTrash && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="添加文档"
              className="lg:hidden fixed right-4 z-30 grid place-items-center w-14 h-14 rounded-full bg-primary-action text-on-primary-action shadow-lg cursor-pointer"
              style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${focusActive ? '8.25rem' : '4.25rem'})` }}>
              <Plus size={26} />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => navigate('/docs/new')}><PenLine size={16} />写文档</MenuItem>
            <MenuItem onSelect={() => fileRef.current?.click()}><Import size={16} />导入文档</MenuItem>
          </MenuContent>
        </DropdownMenu>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.md,.markdown,.txt,.epub,.docx,.pptx"
        className="hidden"
        onChange={(e) => {
          void onImport(e.target.files)
          e.target.value = ''
        }}
      />

      <DocsDialogs
        folders={folders}
        folderCounts={folderCounts}
        folderDialog={folderDialog}
        folderName={folderName}
        onFolderNameChange={setFolderName}
        folderParentId={folderParentId}
        onFolderParentIdChange={setFolderParentId}
        onCloseFolderDialog={() => setFolderDialog(null)}
        onCreateFolder={() => void doCreateFolder()}
        onMoveDoc={(d, fid, fname) => {
          setFolderDialog(null)
          void setDocFolder(d.id, fid).then(() => toast(fname ? `已移到「${fname}」` : '已移回未分类'))
        }}
        folderToDelete={folderToDelete}
        onCloseFolderToDelete={() => setFolderToDelete(null)}
        onConfirmDeleteFolder={(f) => {
          setFolderToDelete(null)
          void deleteFolder(f.id).then(() => {
            if (activeFolder === f.id) setFolderParam(null)
            toast('文件夹已删除')
          })
        }}
        pendingDelete={pendingDelete}
        onClosePendingDelete={() => setPendingDelete(null)}
        onConfirmDeleteDoc={(d) => {
          setPendingDelete(null)
          void deleteDoc(d).then(() => toast('已移入回收站')).catch(() => toast('删除失败，请重试'))
        }}
        metaDoc={metaDoc}
        onCloseMetaDoc={() => setMetaDoc(null)}
        onMetaSaved={(msg) => toast(msg)}
      />

      <AnnotationReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        docs={docs}
        annotations={allAnnotations}
        onJump={(docId, anchor, hlId) => navigate(docPath({ docId, anchor }, hlId))}
      />
    </div>
    </DocDragWorkspace>
  )
}

/** 手机「＋」菜单里的一项 */
