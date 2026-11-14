import { useEffect, useState } from 'react'
import { FolderInput, Quote, X } from 'lucide-react'
import type { Doc, DocReadStatus, Folder } from '@/db/db'
import { updateDocMeta } from '@/db/docs'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { cn } from '@/lib/cn'
import { CitationDialog } from './CitationDialog'
import { buildFolderTree, type FolderTreeNode } from './libraryModel'

export type FolderDialogState = { mode: 'create'; parentId?: string } | { mode: 'move'; doc: Doc } | null

function flattenTree(nodes: FolderTreeNode[]): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = []
  const visit = (n: FolderTreeNode) => {
    out.push({ folder: n.folder, depth: n.depth })
    n.children.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

export function DocsDialogs({
  folders,
  folderCounts,
  folderDialog,
  folderName,
  onFolderNameChange,
  folderParentId,
  onFolderParentIdChange,
  onCloseFolderDialog,
  onCreateFolder,
  onMoveDoc,
  folderToDelete,
  onCloseFolderToDelete,
  onConfirmDeleteFolder,
  pendingDelete,
  onClosePendingDelete,
  onConfirmDeleteDoc,
  metaDoc,
  onCloseMetaDoc,
  onMetaSaved,
}: {
  folders: Folder[]
  folderCounts: Record<string, number>
  folderDialog: FolderDialogState
  folderName: string
  onFolderNameChange: (name: string) => void
  folderParentId?: string
  onFolderParentIdChange?: (parentId: string) => void
  onCloseFolderDialog: () => void
  onCreateFolder: () => void
  onMoveDoc: (doc: Doc, folderId: string | undefined, folderLabel?: string) => void
  folderToDelete: Folder | null
  onCloseFolderToDelete: () => void
  onConfirmDeleteFolder: (folder: Folder) => void
  pendingDelete: Doc | null
  onClosePendingDelete: () => void
  onConfirmDeleteDoc: (doc: Doc) => void
  metaDoc?: Doc | null
  onCloseMetaDoc?: () => void
  onMetaSaved?: (msg: string) => void
}) {
  const flatFolders = flattenTree(buildFolderTree(folders))
  return (
    <>
      <Dialog
        open={folderDialog != null}
        onOpenChange={(v) => !v && onCloseFolderDialog()}
        title={folderDialog?.mode === 'move' ? '移动到文件夹' : '新建文件夹'}
        description={folderDialog?.mode === 'move' ? `把「${folderDialog.doc.title}」放进哪个文件夹？` : '支持多级子文件夹来组织研究主题与长期项目资料。'}
      >
        {folderDialog?.mode === 'move' ? (
          <div className="flex flex-col gap-1.5 max-h-[50dvh] overflow-y-auto">
            <button
              type="button"
              onClick={() => onMoveDoc(folderDialog.doc, undefined)}
              className="h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-left text-[13px] hover:border-primary/50 cursor-pointer shrink-0"
            >
              未分类
            </button>
            {flatFolders.map(({ folder: f, depth }) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onMoveDoc(folderDialog.doc, f.id, f.name)}
                style={depth > 0 ? { paddingLeft: `${12 + depth * 16}px` } : undefined}
                className={cn(
                  'h-10 px-3 rounded-[10px] text-left text-[13px] border transition-colors cursor-pointer flex items-center gap-2 shrink-0',
                  folderDialog.doc.folderId === f.id ? 'border-primary bg-primary-soft text-primary' : 'bg-surface-2 border-outline hover:border-primary/50',
                )}
              >
                <FolderInput size={14} className="shrink-0" />
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
              onChange={(e) => onFolderNameChange(e.target.value)}
              placeholder="文件夹名称，如「毕业论文」"
              className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[14px] outline-none focus:border-primary/60"
              onKeyDown={(e) => { if (e.key === 'Enter' && folderName.trim()) onCreateFolder() }}
            />
            {folders.length > 0 && onFolderParentIdChange && (
              <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
                <span>上级目录（可选）</span>
                <select
                  value={folderParentId ?? ''}
                  onChange={(e) => onFolderParentIdChange(e.target.value)}
                  className="h-9 px-2.5 rounded-[10px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60"
                >
                  <option value="">根目录（顶层文件夹）</option>
                  {flatFolders.map(({ folder: f, depth }) => (
                    <option key={f.id} value={f.id}>
                      {'　'.repeat(depth)}{f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onCloseFolderDialog}>取消</Button>
              <Button variant="primary" disabled={!folderName.trim()} onClick={onCreateFolder}>创建</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={folderToDelete != null}
        onOpenChange={(v) => !v && onCloseFolderToDelete()}
        title="删除文件夹？"
        description="文件夹里的文档不会被删除，子文件夹会保留并上移至上级目录。"
      >
        <div className="flex justify-end gap-2">
          <Button onClick={onCloseFolderToDelete}>取消</Button>
          <Button
            variant="destructive"
            onClick={() => { if (folderToDelete) onConfirmDeleteFolder(folderToDelete) }}
          >
            删除
          </Button>
        </div>
      </Dialog>

      {/* 菜单中的删除统一先确认，鼠标、触摸和键盘共用同一路径。 */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && onClosePendingDelete()}
        title="移入回收站？"
        description={`「${pendingDelete?.title ?? ''}」会移入回收站，可以随时恢复正文、批注和阅读进度。`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={onClosePendingDelete}>取消</Button>
          <Button
            variant="destructive"
            onClick={() => { if (pendingDelete) onConfirmDeleteDoc(pendingDelete) }}
          >
            确认删除
          </Button>
        </div>
      </Dialog>

      {metaDoc && onCloseMetaDoc && (
        <DocMetaDialog doc={metaDoc} onClose={onCloseMetaDoc} onSaved={onMetaSaved} />
      )}
    </>
  )
}

function DocMetaDialog({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved?: (msg: string) => void }) {
  const [title, setTitle] = useState(doc.title)
  const [author, setAuthor] = useState(doc.meta?.author ?? '')
  const [year, setYear] = useState(doc.meta?.year ?? '')
  const [venue, setVenue] = useState(doc.meta?.venue ?? '')
  const [doi, setDoi] = useState(doc.meta?.doi ?? '')
  const [readStatus, setReadStatus] = useState<DocReadStatus>(doc.readStatus ?? 'unread')
  const [tags, setTags] = useState<string[]>(doc.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(doc.title)
    setAuthor(doc.meta?.author ?? '')
    setYear(doc.meta?.year ?? '')
    setVenue(doc.meta?.venue ?? '')
    setDoi(doc.meta?.doi ?? '')
    setReadStatus(doc.readStatus ?? 'unread')
    setTags(doc.tags ?? [])
    setTagInput('')
  }, [doc])

  const commitTag = () => {
    const clean = tagInput.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (!clean.length) return
    setTags((prev) => [...new Set([...prev, ...clean])])
    setTagInput('')
  }

  const [citationOpen, setCitationOpen] = useState(false)
  const citationDoc: Doc = {
    ...doc,
    title: title.trim() || doc.title,
    meta: { author: author.trim() || undefined, year: year.trim() || undefined, venue: venue.trim() || undefined, doi: doi.trim() || undefined },
  }

  const submit = async () => {
    setSaving(true)
    const pendingTags = tagInput.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    try {
      await updateDocMeta(doc.id, {
        title,
        readStatus,
        tags: [...tags, ...pendingTags],
        meta: { author, year, venue, doi },
      })
      onSaved?.('文献信息已更新')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="文献信息与标签" description="维护作者、年份、期刊/DOI 元信息及标签，支持标准引文生成。">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
          <span>文档标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 px-3 rounded-[9px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
          <span>作者</span>
          <textarea rows={3} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="如 Zhang, L.; Li, M." className="px-3 py-2 rounded-[9px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60" />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
            <span>年份</span>
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2025" className="h-9 px-3 rounded-[9px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
            <span>期刊 / 会议 / 来源</span>
            <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="IEEE Trans. / 出版社" className="h-9 px-3 rounded-[9px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
            <span>DOI / 编号</span>
            <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.1109/..." className="h-9 px-3 rounded-[9px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60" />
          </label>
        </div>

        <div className="flex flex-col gap-1 text-[12px] text-on-surface-2">
          <span>阅读状态</span>
          <div className="flex gap-1.5">
            {([['unread', '未读'], ['reading', '在读'], ['done', '已读完']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setReadStatus(v)}
                className={cn(
                  'h-8 px-3 rounded-[8px] border text-[12px] cursor-pointer transition-colors',
                  readStatus === v ? 'bg-primary-soft border-primary/50 text-primary font-medium' : 'bg-surface-2 border-outline text-on-surface-2',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-[12px] text-on-surface-2">
          <span>标签</span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-2 border border-outline text-[12px] text-on-surface">
                {t}
                <button type="button" aria-label={`移除标签 ${t}`} onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="text-on-surface-2 hover:text-danger cursor-pointer">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTag() } }}
              placeholder="输入标签后按回车（支持逗号分隔）"
              className="flex-1 h-9 px-3 rounded-[9px] bg-surface-2 border border-outline text-[13px] text-on-surface outline-none focus:border-primary/60"
            />
            <Button size="sm" onClick={commitTag} disabled={!tagInput.trim()}>添加</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline/60">
          <Button size="sm" variant="outline" onClick={() => setCitationOpen(true)}><Quote size={14} /> 引用…</Button>
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" variant="primary" disabled={saving || !title.trim()} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </div>
      {citationOpen && <CitationDialog doc={citationDoc} onClose={() => setCitationOpen(false)} />}
    </Dialog>
  )
}
