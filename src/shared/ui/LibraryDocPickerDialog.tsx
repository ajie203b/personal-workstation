import { useMemo, useState } from 'react'
import { Check, FileText, Loader2, Search } from 'lucide-react'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { useDocs } from '@/db/hooks'
import { getDocBlob } from '@/db/docs'
import { DOC_KIND_LABEL, type Doc, type DocKind } from '@/db/db'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'

const KIND_EXT: Record<DocKind, { ext: string; mime: string }> = {
  pdf: { ext: '.pdf', mime: 'application/pdf' },
  md: { ext: '.md', mime: 'text/markdown' },
  txt: { ext: '.txt', mime: 'text/plain' },
  docx: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  epub: { ext: '.epub', mime: 'application/epub+zip' },
  html: { ext: '.html', mime: 'text/html' },
}

function fmtSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

export interface PickedLibraryDoc {
  doc: Doc
  file: File
}

export async function docToFile(doc: Doc): Promise<File | null> {
  const blob = await getDocBlob(doc.hash)
  if (!blob) return null
  const spec = KIND_EXT[doc.kind]
  const cleanTitle = doc.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || '文档'
  const fileName = cleanTitle.toLowerCase().endsWith(spec.ext) ? cleanTitle : `${cleanTitle}${spec.ext}`
  return new File([blob], fileName, {
    type: blob.type || spec.mime,
    lastModified: doc.updatedAt ?? doc.addedAt,
  })
}

/**
 * 从文档库直接选取文档的通用弹窗（供 PDF 工具箱、NJUST 报告排版等工具复用，免去先导出再上传）。
 */
export function LibraryDocPickerDialog({
  open,
  onOpenChange,
  kinds,
  multiple = false,
  title = '从文档库选取',
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kinds: readonly DocKind[]
  multiple?: boolean
  title?: string
  onSelect: (items: PickedLibraryDoc[]) => void
}) {
  const docs = useDocs()
  const toast = useUi((s) => s.toast)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const candidates = useMemo(() => {
    const set = new Set(kinds)
    const needle = query.trim().toLowerCase()
    return docs.filter((d) => {
      if (!set.has(d.kind)) return false
      if (!needle) return true
      return d.title.toLowerCase().includes(needle)
    })
  }, [docs, kinds, query])

  const commit = async (targets: Doc[]) => {
    if (!targets.length || loading) return
    setLoading(true)
    try {
      const items: PickedLibraryDoc[] = []
      let missing = 0
      for (const doc of targets) {
        const file = await docToFile(doc)
        if (file) items.push({ doc, file })
        else missing += 1
      }
      if (!items.length) {
        toast('未找到文档本地本体（可能仅同步了元数据且未联网）')
        return
      }
      if (missing > 0) toast(`已跳过 ${missing} 篇缺失本体的文档`)
      setSelectedIds([])
      setQuery('')
      onOpenChange(false)
      onSelect(items)
    } finally {
      setLoading(false)
    }
  }

  const toggleId = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSelectedIds([])
          setQuery('')
        }
        onOpenChange(next)
      }}
      title={title}
      description={`仅显示 ${kinds.map((k) => DOC_KIND_LABEL[k]).join(' / ')} 文档，直接从本机文档库读取`}
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={14} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档标题…"
            aria-label="搜索文档库"
            className="w-full h-9 rounded-[10px] border border-outline bg-surface-2 pl-9 pr-3 text-[13px] outline-none focus:border-primary/60"
          />
        </div>

        {candidates.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-on-surface-2">
            {query ? '没有匹配的文档' : '文档库里暂无可用格式的文档'}
          </p>
        ) : (
          <ul className="max-h-[52dvh] overflow-y-auto overscroll-contain divide-y divide-outline/50 rounded-[12px] border border-outline bg-surface-2/40">
            {candidates.map((doc) => {
              const checked = selectedIds.includes(doc.id)
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (multiple) toggleId(doc.id)
                      else void commit([doc])
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors cursor-pointer',
                      checked ? 'bg-primary-soft/60' : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'grid place-items-center w-8 h-8 rounded-[9px] shrink-0',
                        checked ? 'bg-primary text-on-primary' : 'bg-surface text-primary border border-outline/70',
                      )}
                    >
                      {checked ? <Check size={14} /> : <FileText size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate text-on-surface">{doc.title}</p>
                      <p className="text-[11px] text-on-surface-2 tabular-nums">
                        {DOC_KIND_LABEL[doc.kind]} · {fmtSize(doc.size)}
                        {doc.pages ? ` · ${doc.pages} 页` : ''}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          {multiple && (
            <Button
              variant="primary"
              size="sm"
              disabled={selectedIds.length === 0 || loading}
              onClick={() => {
                const picked = candidates.filter((d) => selectedIds.includes(d.id))
                void commit(picked)
              }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              导入所选（{selectedIds.length}）
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
