import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BookOpen, ChevronRight, FileText, FileType2, FolderInput, FolderPlus, Import, MoreHorizontal, PenLine, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { FileTypeIcon } from '@/shared/FileTypeIcon'
import { IconDocs } from '@/shared/icons'
import type { Doc, Folder } from '@/db/db'
import { DOC_KIND_LABEL } from '@/db/db'
import { deleteDoc, importDoc } from '@/db/docs'
import { createFolder, deleteFolder, setDocFolder } from '@/db/folders'
import { useDocsLive, useAllAnnotations } from '@/db/hooks'
import { dueCards } from '@/lib/review'
import { fmtListDate, todayStr } from '@/lib/date'
import { DocCardSkeleton } from '@/shared/ui/Skeleton'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem as DropdownItem, MenuSeparator } from '@/shared/ui/Menu'
import { openDoc, openDocAtHit } from '@/shared/DeepLink'
import { backfillDocTextIndex } from '@/lib/docTextIndex'
import { morphOpen } from '@/lib/viewTransition'
import { formatBytes } from '@/lib/format'

/** 文档工作站 · 文档库（三栏工作区的入口） */
export function DocsPage() {
  const navigate = useNavigate()
  const docsLive = useDocsLive()
  const docs = useMemo(() => docsLive ?? [], [docsLive])
  const [params, setParams] = useSearchParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const activeFolder = params.get('folder')
  const folders = useLiveQuery(() => db.folders.toArray(), [], [] as Folder[])
  const folderCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of docs) if (d.folderId) m[d.folderId] = (m[d.folderId] ?? 0) + 1
    return m
  }, [docs])
  const docsInView = useMemo(
    () => (activeFolder ? docs.filter((d) => d.folderId === activeFolder) : docs),
    [docs, activeFolder],
  )
  const [folderDialog, setFolderDialog] = useState<{ mode: 'create' } | { mode: 'move'; doc: Doc } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null)
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

  // 搜索：标题命中 + 全文命中（含片段与分段号）
  const results = useMemo(() => {
    const kw = query.trim().toLowerCase()
    if (!kw) return null
    return docs.map((d) => {
      const titleHit = d.title.toLowerCase().includes(kw)
      return { doc: d, titleHit }
    })
  }, [docs, query])

  const textHits = useLiveQuery(async () => {
    const kw = query.trim().toLowerCase()
    if (!kw || kw.length < 2) return {}
    const rows = await db.docText.toArray()
    const map: Record<string, { count: number; snippet: string; seg?: number }> = {}
    for (const r of rows) {
      // 小写副本按 indexedAt 缓存：全文搜索按 keyword 触发，逐字符整篇 toLowerCase 会让输入明显发涩
      let entry = lowerCache.current.get(r.hash)
      if (!entry || entry.at !== r.indexedAt) {
        entry = { at: r.indexedAt, lower: r.text.toLowerCase() }
        lowerCache.current.set(r.hash, entry)
      }
      const lower = entry.lower
      const idx = lower.indexOf(kw)
      if (idx === -1) continue
      // 统计命中次数（前 500 处封顶防长文卡顿）
      let count = 0
      let pos = idx
      while (pos !== -1 && count < 500) { count++; pos = lower.indexOf(kw, pos + kw.length) }
      // 找命中所在分段（页/章/片）
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

  const filtered = useMemo(() => {
    if (!results) return null
    return results.filter((r) => (r.titleHit || (textHits[r.doc.hash]?.count ?? 0) > 0) && docsInView.some((d) => d.id === r.doc.id))
  }, [results, textHits, docsInView])


  /** 当前筛选的文件夹；null = 全部 */
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
    const f = await createFolder(name)
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
    // 先把所有待导入文件摆上屏，再逐个处理 —— 用户能立刻看到「哪个文件在算」
    const jobs = list.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, at: Date.now() }))
    setPending(jobs)
    try {
      await runImport(async () => {
        for (const [i, file] of list.entries()) {
          const jobId = jobs[i].id
          try {
            const r = await importDoc(file)
            // 在某个文件夹里导入 → 直接归入该夹
            if (activeFolder && !r.duplicated) await setDocFolder(r.doc.id, activeFolder)
            if (r.duplicated) dup++
            else added++
          } catch {
            failed++
            toast(`「${file.name}」导入失败`)
          } finally {
            // 这一个处理完就从「进行中」里摘掉，真正的文档卡片接管
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

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 cascade">
      {/* 桌面：标题 + 搜索 / 写作 / 导入 一行放得下 */}
      <div className="hidden md:flex md:items-start gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-8">文档工作站</h1>
          <p className="text-[13px] text-on-surface-2 mt-0.5">本地优先 · 按内容指纹去重 · 阅读进度自动记忆</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题或全文…"
            aria-label="搜索文档"
            className="h-9 w-52 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
          />
          <ReviewButton />
          <Button size="sm" onClick={() => navigate('/docs/new')}>
            <PenLine size={15} /> 写文档
          </Button>
          <Button variant="primary" size="sm" state={importState} onClick={() => fileRef.current?.click()}>
            <Import size={15} /> 导入
          </Button>
        </div>
      </div>

      {/* 手机：搜索框独占一行，写文档 / 导入 / 新建文件夹收进一个「＋」菜单 */}
      <div className="md:hidden flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标题或全文…"
          aria-label="搜索文档"
          className="flex-1 min-w-0 h-9 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
        />
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="更多操作（写文档 / 导入 / 新建文件夹）"
            onClick={() => setMenuOpen((v) => !v)}
            className="w-9 h-9 grid place-items-center rounded-[10px] bg-surface-2 border border-outline text-on-surface cursor-pointer active:scale-95 transition-transform"
          >
            <MoreHorizontal size={19} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="pop absolute right-0 top-11 z-40 w-40 p-1.5 flex flex-col">
                <MenuItem icon={PenLine} onClick={() => { setMenuOpen(false); navigate('/docs/new') }}>写文档</MenuItem>
                <MenuItem icon={Import} onClick={() => { setMenuOpen(false); fileRef.current?.click() }}>导入文件</MenuItem>
                <MenuItem icon={Sparkles} onClick={() => { setMenuOpen(false); navigate('/review') }}>高亮复习</MenuItem>
                <MenuItem icon={FolderPlus} onClick={() => { setMenuOpen(false); setFolderName(''); setFolderDialog({ mode: 'create' }) }}>新建文件夹</MenuItem>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-5">
        {/* 桌面：文件夹变成左侧一列目录树；手机仍在顶部横滑 */}
        <FolderTree
          folders={folders}
          counts={folderCounts}
          total={docs.length}
          active={activeFolder}
          onPick={setFolderParam}
          onCreate={() => { setFolderName(''); setFolderDialog({ mode: 'create' }) }}
          onDelete={() => setFolderToDelete(folders.find((f) => f.id === activeFolder) ?? null)}
        />

        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* 手机 / 平板：顶部横向标签 */}
          <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <FolderChip active={!activeFolder} onClick={() => setFolderParam(null)}>
              全部 <span className="opacity-60">{docs.length}</span>
            </FolderChip>
            {folders.map((f) => (
              <FolderChip key={f.id} active={activeFolder === f.id} onClick={() => setFolderParam(f.id)}>
                {f.name} <span className="opacity-60">{folderCounts[f.id] ?? 0}</span>
              </FolderChip>
            ))}
            <button
              type="button"
              onClick={() => { setFolderName(''); setFolderDialog({ mode: 'create' }) }}
              className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-full border border-dashed border-outline text-[12px] text-on-surface-2 hover:text-on-surface hover:border-primary/50 transition-colors cursor-pointer"
            >
              <FolderPlus size={13} /> 新建文件夹
            </button>
            {activeFolder && (
              <button
                type="button"
                onClick={() => setFolderToDelete(folders.find((f) => f.id === activeFolder) ?? null)}
                className="shrink-0 h-8 px-2.5 rounded-full text-[12px] text-on-surface-2 hover:text-danger cursor-pointer"
              >
                删除文件夹
              </button>
            )}
          </div>

      {pending.length > 0 && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {pending.map((p) => <ImportingCard key={p.id} name={p.name} at={p.at} />)}
        </div>
      )}

      {docsLive === undefined ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {Array.from({ length: 6 }).map((_, i) => <DocCardSkeleton key={i} />)}
        </div>
      ) : docsInView.length === 0 && activeFolder ? (
        <EmptyState
          icon={IconDocs}
          title="这个文件夹还是空的"
          hint="用右上角「⋯」菜单导入，文件会自动归入当前文件夹。"
        />
      ) : docs.length === 0 && pending.length === 0 ? (
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
      ) : filtered !== null && filtered.length === 0 ? (
        <EmptyState icon={Search} title="没有匹配的文档" hint="换个关键词试试（全文搜索需 2 个字符以上）。" />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
          {(filtered ?? docsInView.map((d) => ({ doc: d, titleHit: true }))).map(({ doc: d }) => {
            const pct = Math.round((progressMap[d.hash]?.progressPct ?? 0) * 100)
            const hit = keyword.trim().length >= 2 ? textHits[d.hash] : undefined
            return (
              <DocCard
                key={d.id}
                doc={d}
                pct={pct}
                hit={hit}
                onOpen={() =>
                  // 共享元素转场：文档卡片 → 阅读页连续生长（不支持时自动退化为直接跳转）
                  morphOpen(
                    () => document.getElementById(`doc-${d.id}`),
                    () => (hit?.seg ? openDocAtHit(d, hit.seg) : navigate(`/docs/${d.id}`)),
                  )
                }
                onEdit={() => navigate(`/docs/edit/${d.id}`)}
                onRead={() => openDoc({ docId: d.id })}
                folderName={folders.find((f) => f.id === d.folderId)?.name}
                onMove={() => { setFolderName(''); setFolderDialog({ mode: 'move', doc: d }) }}
                onRequestConfirm={() => setPendingDelete(d)}
              />
            )
          })}
        </div>
      )}
        </div>
      </div>

      {/* 文件选择器挂在根节点：桌面和手机的入口（含空状态里的按钮）共用同一个 ref */}
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

      <Dialog
        open={folderDialog != null}
        onOpenChange={(v) => !v && setFolderDialog(null)}
        title={folderDialog?.mode === 'move' ? '移动到文件夹' : '新建文件夹'}
        description={folderDialog?.mode === 'move' ? `把「${folderDialog.doc.title}」放进哪个文件夹？` : '文件夹用来收拢长期任务相关的资料。'}
      >
        {folderDialog?.mode === 'move' ? (
          <div className="flex flex-col gap-1.5 max-h-[50dvh] overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                const d = folderDialog.doc
                setFolderDialog(null)
                void setDocFolder(d.id, undefined).then(() => toast('已移出文件夹'))
              }}
              className="h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-left text-[13px] hover:border-primary/50 cursor-pointer shrink-0"
            >
              不移入文件夹
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  if (folderDialog.mode !== 'move') return
                  const d = folderDialog.doc
                  setFolderDialog(null)
                  void setDocFolder(d.id, f.id).then(() => toast(`已移到「${f.name}」`))
                }}
                className={cn(
                  'h-10 px-3 rounded-[10px] text-left text-[13px] border transition-colors cursor-pointer flex items-center gap-2',
                  folderDialog.doc.folderId === f.id ? 'border-primary bg-primary-soft text-primary' : 'bg-surface-2 border-outline hover:border-primary/50',
                )}
              >
                <FolderInput size={14} />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-[11px] opacity-60">{folderCounts[f.id] ?? 0}</span>
              </button>
            ))}
            {folders.length === 0 && <p className="text-[12px] text-on-surface-2 py-2">还没有文件夹，先新建一个。</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="文件夹名称，如「毕业论文」"
              className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[14px] outline-none focus:border-primary/60"
              onKeyDown={(e) => { if (e.key === 'Enter' && folderName.trim()) void doCreateFolder() }}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setFolderDialog(null)}>取消</Button>
              <Button variant="primary" disabled={!folderName.trim()} onClick={() => void doCreateFolder()}>创建</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={folderToDelete != null}
        onOpenChange={(v) => !v && setFolderToDelete(null)}
        title="删除文件夹？"
        description="文件夹里的文档不会被删除，只会解除归属；关联的任务也会保留。"
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setFolderToDelete(null)}>取消</Button>
          <Button
            variant="destructive"
            onClick={() => {
              const f = folderToDelete
              setFolderToDelete(null)
              if (!f) return
              void deleteFolder(f.id).then(() => {
                if (activeFolder === f.id) setFolderParam(null)
                toast('文件夹已删除')
              })
            }}
          >
            删除
          </Button>
        </div>
      </Dialog>

      {/* 菜单中的删除统一先确认，鼠标、触摸和键盘共用同一路径。 */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="删除文档？"
        description={`「${pendingDelete?.title ?? ''}」及其批注、进度将被删除，文件本体不可恢复。`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPendingDelete(null)}>取消</Button>
          <Button
            variant="destructive"
            onClick={() => {
              const d = pendingDelete
              setPendingDelete(null)
              if (d) void deleteDoc(d).then(() => toast('文档已删除'))
            }}
          >
            确认删除
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

interface CardProps {
  doc: Doc
  pct: number
  hit?: { count: number; snippet: string; seg?: number }
  folderName?: string
  onMove: () => void
  onOpen: () => void
  onEdit: () => void
  onRead: () => void
  onRequestConfirm: () => void
}

/** 阅读是主动作，菜单集中承载次要操作，卡片高度随内容变化。 */
function DocCard({ doc: d, pct, hit, folderName, onMove, onOpen, onEdit, onRead, onRequestConfirm }: CardProps) {
  return (
    <article id={`doc-${d.id}`} className="card card-hover group relative flex items-start overflow-hidden">
      <button type="button" onClick={onOpen} aria-label={`阅读 ${d.title}`} className="flex flex-1 min-w-0 items-start gap-3 p-4 pr-1 text-left cursor-pointer">
        <span className="grid place-items-center w-10 h-12 rounded-[10px] bg-surface-2 shrink-0" aria-hidden>
          <FileTypeIcon kind={d.kind} size={30} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-ui-body font-medium leading-6 line-clamp-2">{d.title}</span>
          <span className="block text-ui-caption text-on-surface-2 mt-1 leading-5">
            {DOC_KIND_LABEL[d.kind]} · {formatBytes(d.size)}
          </span>
          <span className="block text-ui-caption text-on-surface-2 leading-5 truncate">
            {d.lastOpenedAt
              ? `上次阅读 ${fmtListDate(d.lastOpenedAt)}`
              : `添加于 ${fmtListDate(d.addedAt)}`}
            {folderName && ` · ${folderName}`}
          </span>
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`文档操作：${d.title}`} className="grid place-items-center w-9 h-9 rounded-[10px] m-2 ml-0 shrink-0 text-on-surface-2 hover:bg-surface-2 hover:text-on-surface cursor-pointer transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <MenuContent>
          <DropdownItem onSelect={onRead}><BookOpen size={16} aria-hidden />继续阅读</DropdownItem>
          {d.kind === 'md' && <DropdownItem onSelect={onEdit}><PenLine size={16} aria-hidden />继续写作</DropdownItem>}
          <DropdownItem onSelect={onMove}><FolderInput size={16} aria-hidden />移动到文件夹</DropdownItem>
          <MenuSeparator />
          <DropdownItem danger onSelect={onRequestConfirm}><Trash2 size={16} aria-hidden />删除文档…</DropdownItem>
        </MenuContent>
      </DropdownMenu>
    </article>
  )
}
function FolderChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] transition-colors cursor-pointer',
        active ? 'bg-primary-soft border-primary/40 text-primary font-medium' : 'bg-surface-2 border-outline text-on-surface-2 hover:text-on-surface',
      )}
    >
      {children}
    </button>
  )
}

function segLabel(kind: Doc['kind'], seg: number): string {
  if (kind === 'pdf') return `第${seg}页`
  if (kind === 'pptx') return `第${seg}片`
  if (kind === 'epub') return `第${seg}章`
  return `#${seg}`
}

/**
 * 高亮复习入口：常驻文档页顶部。
 * 原来只在今日页「有到期卡片」时才冒出来一张卡，入口等于没有 —— 现在固定在文档库工具条上。
 */
function ReviewButton() {
  const navigate = useNavigate()
  const anns = useAllAnnotations()
  const due = useMemo(() => dueCards(anns, todayStr()).length, [anns])
  return (
    <button
      type="button"
      onClick={() => navigate('/review')}
      aria-label={due > 0 ? `高亮复习，${due} 张到期` : '高亮复习'}
      title={due > 0 ? `${due} 张高亮到期` : '还没有到期的高亮'}
      className={cn(
        'relative h-9 px-3 rounded-[10px] border text-[13px] inline-flex items-center gap-1.5 transition-colors cursor-pointer',
        due > 0
          ? 'border-primary/40 bg-primary-soft text-primary'
          : 'border-outline text-on-surface-2 hover:text-on-surface',
      )}
    >
      <Sparkles size={15} /> 复习
      {due > 0 && (
        <span className="grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10.5px] font-semibold tabular-nums">
          {due > 99 ? '99+' : due}
        </span>
      )}
    </button>
  )
}

/**
 * 导入中的卡片（ui-motion 43「照片上传进度」的信息版）：
 * 卡片先到位、占住真实卡片的位置，扫光条来回走，等指纹算完再换成真卡。
 * 大 PDF 算 SHA-256 要好几百毫秒起步，之前点完「导入」什么都不动，像没反应。
 */
function ImportingCard({ name, at }: { name: string; at: number }) {
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

/** 手机「＋」菜单里的一项 */function MenuItem({ icon: Icon, onClick, children }: { icon: typeof Plus; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 h-9 px-2.5 rounded-[8px] text-[13px] text-left hover:bg-surface-3 cursor-pointer"
    >
      <Icon size={15} className="text-on-surface-2" />
      {children}
    </button>
  )
}

/** 桌面侧边文件夹树（手机用顶部横向标签） */
function FolderTree({
  folders, counts, total, active, onPick, onCreate, onDelete,
}: {
  folders: Folder[]
  counts: Record<string, number>
  total: number
  active: string | null
  onPick: (id: string | null) => void
  onCreate: () => void
  onDelete: () => void
}) {
  return (
    <aside className="hidden lg:flex flex-col gap-0.5 w-44 shrink-0 sticky top-2">
      <p className="text-[11px] font-medium text-on-surface-2 tracking-wide px-2 mb-1">文件夹</p>
      <TreeItem active={!active} onClick={() => onPick(null)} icon={FileText} label="全部文档" count={total} />
      {folders.map((f) => (
        <TreeItem key={f.id} active={active === f.id} onClick={() => onPick(f.id)} icon={FolderInput} label={f.name} count={counts[f.id] ?? 0} />
      ))}
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center gap-2 h-8 px-2 mt-1 rounded-[8px] text-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
      >
        <FolderPlus size={14} /> 新建文件夹
      </button>
      {active && (
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-2 h-8 px-2 rounded-[8px] text-[12px] text-on-surface-2 hover:bg-danger/10 hover:text-danger cursor-pointer"
        >
          <Trash2 size={14} /> 删除文件夹
        </button>
      )}
    </aside>
  )
}

function TreeItem({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: typeof FileText; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 h-8 px-2 rounded-[8px] text-[13px] transition-colors cursor-pointer text-left',
        active ? 'bg-primary-soft text-primary font-medium' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate flex-1">{label}</span>
      <span className="text-[11px] tabular-nums opacity-60">{count}</span>
      {active && <ChevronRight size={12} className="shrink-0 opacity-60" />}
    </button>
  )
}
