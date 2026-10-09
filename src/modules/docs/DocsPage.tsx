import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlignLeft, BookOpen, FileText, FileSpreadsheet, FileType2, Import, PenLine, Presentation, Search, Trash2 } from 'lucide-react'
import type { Doc } from '@/db/db'
import { DOC_KIND_LABEL } from '@/db/db'
import { deleteDoc, importDoc } from '@/db/docs'
import { useDocs } from '@/db/hooks'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { HoldToConfirm } from '@/shared/ui/HoldToConfirm'
import { openDoc, openDocAtHit } from '@/shared/DeepLink'
import { backfillDocTextIndex } from '@/lib/docTextIndex'

/** 文档工作站 · 文档库（三栏工作区的入口） */
export function DocsPage() {
  const navigate = useNavigate()
  const docs = useDocs()
  const toast = useUi((s) => s.toast)
  const [keyword, setKeyword] = useState('')
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

  // 全文索引：进入页面静默回填（每轮 5 篇，直至补齐）
  useEffect(() => {
    let alive = true
    const tick = () => {
      if (!alive) return
      void backfillDocTextIndex(5).then((n) => { if (n > 0) tick() })
    }
    tick()
    return () => { alive = false }
  }, [])

  // 搜索：标题命中 + 全文命中（含片段与分段号）
  const results = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return null
    return docs.map((d) => {
      const titleHit = d.title.toLowerCase().includes(kw)
      return { doc: d, titleHit }
    })
  }, [docs, keyword])

  const textHits = useLiveQuery(async () => {
    const kw = keyword.trim().toLowerCase()
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
  }, [keyword], {} as Record<string, { count: number; snippet: string; seg?: number }>)

  const filtered = useMemo(() => {
    if (!results) return null
    return results.filter((r) => r.titleHit || (textHits[r.doc.hash]?.count ?? 0) > 0)
  }, [results, textHits])

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

      {docs.length === 0 ? (
        <EmptyState
          icon={FileType2}
          title="文档库还是空的"
          hint="导入 PDF / EPUB / Word / PPT / Markdown / TXT，或直接用编辑器写一篇。支持划词高亮、批注转任务、关掉重开自动回到上次位置。"
        >
          <div className="flex gap-2 justify-center">
            <Button variant="primary" size="sm" onClick={() => navigate('/docs/new')}>
              <PenLine size={15} /> 写文档
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Import size={15} /> 选择文件
            </Button>
          </div>
        </EmptyState>
      ) : filtered !== null && filtered.length === 0 ? (
        <EmptyState icon={Search} title="没有匹配的文档" hint="换个关键词试试（全文搜索需 2 个字符以上）。" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(filtered ?? docs.map((d) => ({ doc: d, titleHit: true }))).map(({ doc: d }) => {
            const pct = Math.round((progressMap[d.hash]?.progressPct ?? 0) * 100)
            const hit = keyword.trim().length >= 2 ? textHits[d.hash] : undefined
            return (
              <button
                key={d.id}
                onClick={() => {
                  // 全文命中且能定位分段 → 直接跳到对应页/章/片（PDF 用页码，流式文档用段下标）
                  if (hit?.seg) openDocAtHit(d, hit.seg)
                  else navigate(`/docs/${d.id}`)
                }}
                className="card card-hover text-left px-4 py-3.5 flex gap-3.5 cursor-pointer"
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
                  </span>
                  {hit && (
                    <span className="block text-[12px] text-on-surface mt-1.5 leading-snug line-clamp-2">
                      <span className="text-primary font-medium">{hit.count} 处命中{hit.seg ? ` · ${segLabel(d.kind, hit.seg)}` : ''}：</span>                      {hit.snippet}
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
                  <span role="button" tabIndex={0} aria-label="继续阅读"
                    title="继续阅读"
                    onClick={(e) => {
                      e.stopPropagation()
                      openDoc({ docId: d.id })
                    }}
                    className="grid place-items-center w-8 h-8 rounded-[10px] text-primary hover:bg-primary-soft cursor-pointer"
                  >
                    <Import size={15} className="rotate-180" />
                  </span>
                  <span role="button" tabIndex={0} aria-label="删除文档"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(d)
                    }}
                    className="grid place-items-center w-8 h-8 rounded-[10px] text-on-surface-2 hover:bg-danger/10 hover:text-danger cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 删除是不可逆操作：走长按蓄力（键盘/减弱动效自动降级为二次确认框） */}
      {pendingDelete && (
        <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50">
          <HoldToConfirm
            label="确认删除"
            dialogTitle="删除文档？"
            dialogDescription={`「${pendingDelete.title}」及其批注、进度将被删除，文件本体不可恢复。`}
            onConfirm={() => {
              void deleteDoc(pendingDelete).then(() => toast('文档已删除'))
              setPendingDelete(null)
            }}
          />
        </div>
      )}
    </div>
  )
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
