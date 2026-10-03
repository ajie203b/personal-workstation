import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileText, FileType2, Import, PenLine, Search, Trash2 } from 'lucide-react'
import type { Doc } from '@/db/db'
import { deleteDoc, importDoc } from '@/db/docs'
import { useDocs } from '@/db/hooks'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { openDoc } from '@/shared/DeepLink'

/** 文档工作站 · 文档库（三栏工作区的入口） */
export function DocsPage() {
  const navigate = useNavigate()
  const docs = useDocs()
  const toast = useUi((s) => s.toast)
  const [keyword, setKeyword] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Doc | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const progressMap = useLiveQuery(
    async () => {
      const all = await db.positions.toArray()
      return Object.fromEntries(all.map((p) => [p.hash, p]))
    },
    [],
    {} as Record<string, { progressPct?: number; updatedAt: number }>,
  )

  const filtered = useMemo(
    () => docs.filter((d) => d.title.toLowerCase().includes(keyword.trim().toLowerCase())),
    [docs, keyword],
  )

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return
    setImporting(true)
    let added = 0
    let dup = 0
    for (const file of Array.from(files)) {
      try {
        const r = await importDoc(file)
        if (r.duplicated) dup++
        else added++
      } catch {
        toast(`「${file.name}」导入失败`)
      }
    }
    setImporting(false)
    if (added) toast(`已导入 ${added} 个文档${dup ? `，${dup} 个重复已跳过` : ''}`)
    else if (dup) toast('文档已存在（内容相同），无需重复导入')
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-8">文档工作站</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5">本地优先 · 按内容指纹去重 · 阅读进度自动记忆</p>
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题…"
            aria-label="搜索文档"
            className="h-9 w-36 sm:w-44 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
          />
          <Button size="sm" onClick={() => navigate('/docs/new')}>
            <PenLine size={15} /> 写文档
          </Button>
          <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Import size={15} /> {importing ? '导入中…' : '导入'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.md,.markdown,.txt"
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
          hint="导入 PDF / Markdown / TXT，或直接用编辑器写一篇。支持划词高亮、批注转任务、关掉重开自动回到上次位置。"
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
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="没有匹配的文档" hint="换个关键词试试。" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((d) => {
            const pct = Math.round((progressMap[d.hash]?.progressPct ?? 0) * 100)
            return (
              <button
                key={d.id}
                onClick={() => navigate(`/docs/${d.id}`)}
                className="card card-hover text-left px-4 py-3.5 flex gap-3.5 cursor-pointer"
              >
                <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
                  {d.kind === 'pdf' ? <FileText size={20} /> : <FileType2 size={20} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] font-semibold truncate">{d.title}</span>
                  <span className="block text-[11.5px] text-on-surface-2 mt-0.5">
                    {d.kind === 'pdf' ? 'PDF' : 'Markdown'} · {formatSize(d.size)} ·{' '}
                    {d.lastOpenedAt
                      ? `上次阅读 ${new Date(d.lastOpenedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
                      : `添加于 ${new Date(d.addedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
                  </span>
                  <span className="flex items-center gap-2 mt-2">
                    <span className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                      <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[11px] text-on-surface-2 tabular-nums">{pct}%</span>
                  </span>
                </span>
                <span className="flex flex-col gap-1 self-start">
                  <span
                    role="button"
                    aria-label="继续阅读"
                    title="继续阅读"
                    onClick={(e) => {
                      e.stopPropagation()
                      openDoc({ docId: d.id })
                    }}
                    className="grid place-items-center w-8 h-8 rounded-[10px] text-primary hover:bg-primary-soft cursor-pointer"
                  >
                    <Import size={15} className="rotate-180" />
                  </span>
                  <span
                    role="button"
                    aria-label="删除文档"
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

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="删除文档？"
        description={`「${pendingDelete?.title ?? ''}」及其批注、进度将被删除，文件本体不可恢复。`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPendingDelete(null)}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (pendingDelete) void deleteDoc(pendingDelete).then(() => toast('文档已删除'))
              setPendingDelete(null)
            }}
          >
            确认删除
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
