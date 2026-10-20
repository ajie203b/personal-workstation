import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlignLeft, BookOpen, FileText, FileSpreadsheet, FileType2, FolderInput, FolderPlus, Import, PenLine, Presentation, Search, Trash2 } from 'lucide-react'
import type { Doc, Folder } from '@/db/db'
import { DOC_KIND_LABEL } from '@/db/db'
import { deleteDoc, importDoc } from '@/db/docs'
import { createFolder, deleteFolder, setDocFolder } from '@/db/folders'
import { useDocs } from '@/db/hooks'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { useHoldToConfirm } from '@/shared/ui/useHoldToConfirm'
import { openDoc, openDocAtHit } from '@/shared/DeepLink'
import { backfillDocTextIndex } from '@/lib/docTextIndex'
import { morphOpen } from '@/lib/viewTransition'

/** 绕卡片蓄力的时长：文案与计时共用这一个值 */
const DELETE_HOLD_MS = 1500

/** 文档工作站 · 文档库（三栏工作区的入口） */
export function DocsPage() {
  const navigate = useNavigate()
  const docs = useDocs()
  const [params, setParams] = useSearchParams()
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

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return
    let added = 0
    let dup = 0
    let failed = 0
    try {
      await runImport(async () => {
        for (const file of Array.from(files)) {
          try {
            const r = await importDoc(file)
            // 在某个文件夹里导入 → 直接归入该夹
            if (activeFolder && !r.duplicated) await setDocFolder(r.doc.id, activeFolder)
            if (r.duplicated) dup++
            else added++
          } catch {
            failed++
            toast(`「${file.name}」导入失败`)
          }
        }
        if (added) toast(`已导入 ${added} 个文档${dup ? `，${dup} 个重复已跳过` : ''}`)
        else if (dup) toast('文档已存在（内容相同），无需重复导入')
        if (!added && failed) throw new Error('导入失败')
      })
    } catch {
      /* 失败态已由按钮呈现 */
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-8">文档工作站</h1>
          <p className="text-[13px] text-on-surface-2 mt-0.5">本地优先 · 按内容指纹去重 · 阅读进度自动记忆</p>
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题或全文…"
            aria-label="搜索文档"
            className="h-9 w-36 sm:w-52 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
          />
          <Button size="sm" onClick={() => navigate('/docs/new')}>
            <PenLine size={15} /> 写文档
          </Button>
          <Button variant="primary" size="sm" state={importState} onClick={() => fileRef.current?.click()}>
            <Import size={15} /> 导入
          </Button>
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
        </div>
      </div>

      {/* 文件夹筛选：长期任务的资料夹 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
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

      {docsInView.length === 0 && activeFolder ? (
        <EmptyState
          icon={FileType2}
          title="这个文件夹还是空的"
          hint="点右上角「导入」把资料放进来；在这里导入的文件会自动归入当前文件夹。"
        />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileType2}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                onDelete={() => {
                  void deleteDoc(d).then(() => toast('文档已删除'))
                }}
              />
            )
          })}
        </div>
      )}

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
            variant="primary"
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

      {/* 删除的正常路径是按住垃圾桶让光绕卡片一周；键盘与减弱动效走这个兜底二次确认 */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="删除文档？"
        description={`「${pendingDelete?.title ?? ''}」及其批注、进度将被删除，文件本体不可恢复。`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPendingDelete(null)}>取消</Button>
          <Button
            variant="primary"
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
  /** 键盘 / 减弱动效时请求父级弹出二次确认框 */
  onRequestConfirm: () => void
  onDelete: () => void
}

/** 文档卡：整卡可点开，右上角行内动作分别负责阅读 / 写作 / 删除 */
function DocCard({ doc: d, pct, hit, folderName, onMove, onOpen, onEdit, onRead, onRequestConfirm, onDelete }: CardProps) {
  const { progress, bind } = useHoldToConfirm({
    holdMs: DELETE_HOLD_MS,
    onComplete: onDelete,
    onFallback: onRequestConfirm,
  })

  return (
    <button
      type="button"
      id={`doc-${d.id}`}
      onClick={onOpen}
      className="card card-hover relative overflow-hidden text-left px-4 py-3.5 flex gap-3.5 cursor-pointer"
    >
      <span className="grid place-items-center w-11 h-11 rounded-[12px] text-on-surface-2/80 shrink-0">
        <KindIcon kind={d.kind} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold truncate">{d.title}</span>
        <span className="block text-[12px] text-on-surface-2 mt-0.5">
          {DOC_KIND_LABEL[d.kind]} · {formatSize(d.size)} ·{' '}
          {d.lastOpenedAt
            ? `上次阅读 ${new Date(d.lastOpenedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
            : `添加于 ${new Date(d.addedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
          {folderName && ` · ${folderName}`}
        </span>
        {hit && (
          <span className="block text-[12px] text-on-surface mt-1.5 leading-snug line-clamp-2">
            <span className="text-primary font-medium">{hit.count} 处命中{hit.seg ? ` · ${segLabel(d.kind, hit.seg)}` : ''}：</span>            {hit.snippet}
          </span>
        )}
        <span className="flex items-center gap-2 mt-2">
          <span className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <span className="block h-full w-full rounded-full bg-primary transition-transform duration-300 origin-left" style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
          <span className="text-[11px] text-on-surface-2 tabular-nums">{pct}%</span>
        </span>
      </span>
      <span className="flex flex-col gap-1 self-start">
        <CardAction label="继续阅读" primary onClick={onRead}>
          <Import size={15} className="rotate-180" />
        </CardAction>
        <CardAction label="移动到文件夹" onClick={onMove}>
          <FolderInput size={15} />
        </CardAction>
        {d.kind === 'md' && (
          <CardAction label="继续写作" onClick={onEdit}>
            <PenLine size={15} />
          </CardAction>
        )}
        <CardAction
          label={`删除文档（按住 ${DELETE_HOLD_MS / 1000} 秒，光绕卡片一周后删除）`}
          danger
          actionBind={bind}
          onClick={() => undefined}
        >
          <Trash2 size={15} />
        </CardAction>
      </span>
      <HoldRing progress={progress} />
    </button>
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

/** 卡片行内动作：外层已是 button，嵌套 button 不合法，用 span[role=button] 并补键盘激活 */
function CardAction({
  label, onClick, danger = false, primary = false, actionBind, children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  primary?: boolean
  /** 长按蓄力的指针/键盘处理器（删除用） */
  actionBind?: React.HTMLAttributes<HTMLSpanElement> & Record<string, unknown>
  children: React.ReactNode
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      {...actionBind}
      className={cn(
        'grid place-items-center w-8 h-8 rounded-[10px] cursor-pointer transition-colors touch-manipulation',
        danger ? 'text-on-surface-2 hover:bg-danger/10 hover:text-danger'
        : primary ? 'text-primary hover:bg-primary-soft'
        : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
      )}
    >
      {children}
    </span>
  )
}

/**
 * 蓄力光点：一个光点沿文档卡的圆角外轮廓跑满一周即执行删除。
 * 光点跑过的段落描边加重成危险色（越走越实），未跑到的段落保持微弱底轨提示路线。
 * 光点位置与描边进度共用同一套周长分段换算，保证光点永远压在已染色描边的头部。
 * pathLength=1 让描边进度与卡片实际周长无关；尺寸靠 ResizeObserver 量，
 * 避免用 SVG 的 CSS 几何属性（老内核会整条不画，等于删除没了反馈）。
 */
function HoldRing({ progress }: { progress: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 光路向内收 4px：光点晕光半径 4px，外缘恰好贴到卡片边界，不会被卡片的 overflow-hidden 裁切
  const inset = 4
  const w = box.w - inset * 2
  const h = box.h - inset * 2
  const ready = progress > 0 && w > 0 && h > 0

  const r = ready ? Math.max(2, Math.min(15, w / 2 - 1, h / 2 - 1)) : 0
  const path = ready ? perimeterPath(w, h, r) : ''
  const pt = ready ? perimeterPoint(w, h, r, progress) : { x: 0, y: 0 }

  return (
    // 关键：覆盖层必须始终挂载——提前 return null 会让 ref 绑不上、尺寸量不到，光效永远不显示
    <span ref={ref} className="absolute inset-0 z-10 pointer-events-none" aria-hidden>
      {ready && (
      <svg width={box.w} height={box.h}>
        <g transform={`translate(${inset} ${inset})`}>
          {/* 底轨：微亮的完整外轮廓，提示光点要跑的路线 */}
          <path
            d={path}
            fill="none"
            stroke="var(--danger)"
            strokeOpacity={0.18}
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* 光点已跑过的段落：颜色加重、越走越实 */}
          <path
            d={path}
            fill="none"
            stroke={trailColor(progress)}
            strokeWidth={2.5}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - progress}
          />
          {/* 光点本体：外层晕光 + 内层实心核 */}
          <circle cx={pt.x} cy={pt.y} r={4} fill="var(--danger)" opacity={0.25} />
          <circle cx={pt.x} cy={pt.y} r={2.2} fill="var(--danger)" />
        </g>
      </svg>
      )}
    </span>
  )
}

/** 卡片外轮廓（圆角矩形）路径：从顶边中点起顺时针一圈回到起点，描边进度 0→1 与光点位置一一对应 */
function perimeterPath(w: number, h: number, r: number): string {
  return [
    `M ${w / 2} 0`,
    `H ${w - r}`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `V ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    `H ${w / 2}`,
  ].join(' ')
}

/** 外轮廓上 t（0→1，从顶边中点顺时针）处的坐标：与 perimeterPath 的分段一一对应 */
function perimeterPoint(w: number, h: number, r: number, t: number): { x: number; y: number } {
  // 路径分段：顶边右半 → 右上圆角 → 右边 → 右下圆角 → 底边 → 左下圆角 → 左边 → 左上圆角 → 顶边左半
  const topHalf = w / 2 - r
  const top = w - 2 * r
  const side = h - 2 * r
  const arc = (Math.PI * r) / 2
  const segs = [topHalf, arc, side, arc, top, arc, side, arc, topHalf]
  const total = 2 * topHalf + top + 2 * side + 4 * arc
  let d = Math.min(Math.max(t, 0), 1) * total

  for (let i = 0; i < segs.length; i++) {
    if (d > segs[i]) { d -= segs[i]; continue }
    switch (i) {
      case 0: return { x: w / 2 + d, y: 0 } // 顶边右半 →
      case 1: { // 右上圆角
        const a = -Math.PI / 2 + d / r
        return { x: w - r + r * Math.cos(a), y: r + r * Math.sin(a) }
      }
      case 2: return { x: w, y: r + d } // 右边 ↓
      case 3: { // 右下圆角
        const a = d / r
        return { x: w - r + r * Math.cos(a), y: h - r + r * Math.sin(a) }
      }
      case 4: return { x: w - r - d, y: h } // 底边 ←
      case 5: { // 左下圆角
        const a = Math.PI / 2 + d / r
        return { x: r + r * Math.cos(a), y: h - r + r * Math.sin(a) }
      }
      case 6: return { x: 0, y: h - r - d } // 左边 ↑
      case 7: { // 左上圆角
        const a = Math.PI + d / r
        return { x: r + r * Math.cos(a), y: r + r * Math.sin(a) }
      }
      default: return { x: r + d, y: 0 } // 顶边左半 →（回到中点）
    }
  }
  return { x: w / 2, y: 0 }
}

/** 光轨颜色：淡红 → 纯红，越接近走满越实 */
function trailColor(p: number): string {
  if (p < 0.5) return `color-mix(in srgb, var(--danger) ${Math.round(35 + p * 60)}%, transparent)`
  return 'var(--danger)'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function KindIcon({ kind }: { kind: Doc['kind'] }) {
  const size = 20
  switch (kind) {
    case 'pdf': return <FileText size={size} />
    case 'epub': return <BookOpen size={size} />
    case 'docx': return <FileSpreadsheet size={size} />
    case 'pptx': return <Presentation size={size} />
    case 'txt': return <AlignLeft size={size} />
    default: return <FileType2 size={size} />
  }
}

function segLabel(kind: Doc['kind'], seg: number): string {
  if (kind === 'pdf') return `第${seg}页`
  if (kind === 'pptx') return `第${seg}片`
  if (kind === 'epub') return `第${seg}章`
  return `#${seg}`
}
