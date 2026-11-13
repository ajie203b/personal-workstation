import { useState } from 'react'
import { ChevronDown, ChevronRight, Clock, FileText, FolderInput, FolderPlus, Highlighter, Layers, Plus, Star, Trash2 } from 'lucide-react'
import type { Folder } from '@/db/db'
import { cn } from '@/lib/cn'
import { TRASH_FOLDER, UNFILED_FOLDER, useDocDropTarget } from './DocDrag'
import {
  ALL_DOCS_VIEW,
  ANNOTATED_VIEW,
  RECENT_VIEW,
  STARRED_VIEW,
  buildFolderTree,
  collectSubtreeIds,
  type FolderTreeNode,
} from './libraryModel'

export function FolderChip({
  active,
  onClick,
  children,
  dropId,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  dropId?: string
}) {
  const { setNodeRef, isOver } = useDocDropTarget(dropId ?? '__noop__')
  return (
    <button
      ref={dropId ? setNodeRef : undefined}
      data-doc-drop={dropId}
      type="button"
      onClick={onClick}
      className={cn(
        dropId && isOver && 'ring-2 ring-primary bg-primary-soft',
        'shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] transition-colors cursor-pointer',
        active ? 'bg-primary-soft border-primary/40 text-primary font-medium' : 'bg-surface-2 border-outline text-on-surface-2 hover:text-on-surface',
      )}
    >
      {children}
    </button>
  )
}

function subtreeCount(folderId: string, folders: readonly Folder[], counts: Record<string, number>): number {
  let sum = 0
  for (const id of collectSubtreeIds(folderId, folders)) sum += counts[id] ?? 0
  return sum
}

/** 手机 / 平板：顶部横向视图 + 文件夹标签栏 */
export function FolderStripMobile({
  folders,
  counts,
  allCount,
  starredCount,
  recentCount,
  annotatedCount,
  uncategorizedCount,
  trashCount,
  activeFolder,
  inTrash,
  onPick,
  onCreate,
  onDelete,
}: {
  folders: Folder[]
  counts: Record<string, number>
  allCount: number
  starredCount: number
  recentCount: number
  annotatedCount: number
  uncategorizedCount: number
  trashCount: number
  activeFolder: string | null
  inTrash: boolean
  onPick: (id: string | null) => void
  onCreate: (parentId?: string) => void
  onDelete: () => void
}) {
  const cur = activeFolder ?? ALL_DOCS_VIEW
  const isUserFolder = folders.some((f) => f.id === activeFolder)
  return (
    <div className="lg:hidden flex items-start gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <FolderChip active={cur === ALL_DOCS_VIEW} onClick={() => onPick(null)}>
          全部 <span className="opacity-60">{allCount}</span>
        </FolderChip>
        <FolderChip active={cur === STARRED_VIEW} onClick={() => onPick(STARRED_VIEW)}>
          星标 <span className="opacity-60">{starredCount}</span>
        </FolderChip>
        <FolderChip active={cur === RECENT_VIEW} onClick={() => onPick(RECENT_VIEW)}>
          最近 <span className="opacity-60">{recentCount}</span>
        </FolderChip>
        <FolderChip active={cur === ANNOTATED_VIEW} onClick={() => onPick(ANNOTATED_VIEW)}>
          有批注 <span className="opacity-60">{annotatedCount}</span>
        </FolderChip>
        <FolderChip dropId={UNFILED_FOLDER} active={cur === UNFILED_FOLDER} onClick={() => onPick(UNFILED_FOLDER)}>
          未分类 <span className="opacity-60">{uncategorizedCount}</span>
        </FolderChip>
        {folders.map((f) => (
          <FolderChip key={f.id} dropId={f.id} active={activeFolder === f.id} onClick={() => onPick(f.id)}>
            {f.name} <span className="opacity-60">{subtreeCount(f.id, folders, counts)}</span>
          </FolderChip>
        ))}
        <button
          type="button"
          onClick={() => onCreate()}
          className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-full border border-dashed border-outline text-[12px] text-on-surface-2 hover:text-on-surface hover:border-primary/50 transition-colors cursor-pointer"
        >
          <FolderPlus size={13} /> 新建文件夹
        </button>
        {isUserFolder && !inTrash && (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 h-8 px-2.5 rounded-full text-[12px] text-on-surface-2 hover:text-danger cursor-pointer"
          >
            删除文件夹
          </button>
        )}
      </div>
      <FolderChip dropId={TRASH_FOLDER} active={inTrash} onClick={() => onPick(TRASH_FOLDER)}>
        <Trash2 size={13} />回收站 <span className="opacity-60">{trashCount}</span>
      </FolderChip>
    </div>
  )
}

/** 桌面侧边聚合视图 + 多级文件夹树 */
export function FolderTree({
  folders,
  counts,
  allCount,
  starredCount,
  recentCount,
  annotatedCount,
  uncategorizedCount,
  trashCount,
  active,
  onPick,
  onCreate,
  onDelete,
}: {
  folders: Folder[]
  counts: Record<string, number>
  allCount: number
  starredCount: number
  recentCount: number
  annotatedCount: number
  uncategorizedCount: number
  trashCount: number
  active: string | null
  onPick: (id: string | null) => void
  onCreate: (parentId?: string) => void
  onDelete: () => void
}) {
  const cur = active ?? ALL_DOCS_VIEW
  const tree = buildFolderTree(folders)
  const isUserFolder = folders.some((f) => f.id === active)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="hidden lg:flex flex-col gap-0.5 w-48 shrink-0 sticky top-2">
      <p className="text-[11px] font-medium text-on-surface-2 tracking-wide px-2 mb-1">智能视图</p>
      <TreeItem active={cur === ALL_DOCS_VIEW} onClick={() => onPick(null)} icon={Layers} label="全部文档" count={allCount} />
      <TreeItem active={cur === STARRED_VIEW} onClick={() => onPick(STARRED_VIEW)} icon={Star} label="星标收藏" count={starredCount} />
      <TreeItem active={cur === RECENT_VIEW} onClick={() => onPick(RECENT_VIEW)} icon={Clock} label="最近阅读" count={recentCount} />
      <TreeItem active={cur === ANNOTATED_VIEW} onClick={() => onPick(ANNOTATED_VIEW)} icon={Highlighter} label="有批注" count={annotatedCount} />
      <TreeItem dropId={UNFILED_FOLDER} active={cur === UNFILED_FOLDER} onClick={() => onPick(UNFILED_FOLDER)} icon={FileText} label="未分类文档" count={uncategorizedCount} />

      <p className="text-[11px] font-medium text-on-surface-2 tracking-wide px-2 mt-3 mb-1">文件夹</p>
      {tree.map((node) => (
        <FolderBranch
          key={node.folder.id}
          node={node}
          folders={folders}
          counts={counts}
          active={active}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onPick={onPick}
          onCreateChild={(pid) => onCreate(pid)}
        />
      ))}

      <TreeItem dropId={TRASH_FOLDER} active={active === TRASH_FOLDER} onClick={() => onPick(TRASH_FOLDER)} icon={Trash2} label="回收站" count={trashCount} />
      <button
        type="button"
        onClick={() => onCreate()}
        className="flex items-center gap-2 h-8 px-2 mt-1 rounded-[8px] text-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
      >
        <FolderPlus size={14} /> 新建文件夹
      </button>
      {isUserFolder && active !== TRASH_FOLDER && (
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-2 h-8 px-2 rounded-[8px] text-[12px] text-on-surface-2 hover:bg-danger/10 hover:text-danger cursor-pointer"
        >
          <Trash2 size={14} /> 删除当前文件夹
        </button>
      )}
    </aside>
  )
}

function FolderBranch({
  node,
  folders,
  counts,
  active,
  collapsed,
  onToggleCollapse,
  onPick,
  onCreateChild,
}: {
  node: FolderTreeNode
  folders: readonly Folder[]
  counts: Record<string, number>
  active: string | null
  collapsed: Set<string>
  onToggleCollapse: (id: string) => void
  onPick: (id: string | null) => void
  onCreateChild: (parentId: string) => void
}) {
  const { folder, children, depth } = node
  const hasChildren = children.length > 0
  const isClosed = collapsed.has(folder.id)
  const count = subtreeCount(folder.id, folders, counts)
  return (
    <>
      <TreeItem
        dropId={folder.id}
        active={active === folder.id}
        onClick={() => onPick(folder.id)}
        icon={FolderInput}
        label={folder.name}
        count={count}
        depth={depth}
        hasChildren={hasChildren}
        expanded={!isClosed}
        onToggleExpand={hasChildren ? () => onToggleCollapse(folder.id) : undefined}
        onCreateChild={() => onCreateChild(folder.id)}
      />
      {!isClosed && children.map((child) => (
        <FolderBranch
          key={child.folder.id}
          node={child}
          folders={folders}
          counts={counts}
          active={active}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onPick={onPick}
          onCreateChild={onCreateChild}
        />
      ))}
    </>
  )
}

function TreeItem({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  dropId,
  depth = 0,
  hasChildren,
  expanded,
  onToggleExpand,
  onCreateChild,
}: {
  active: boolean
  onClick: () => void
  icon: typeof FileText
  label: string
  count: number
  dropId?: string
  depth?: number
  hasChildren?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  onCreateChild?: () => void
}) {
  const { setNodeRef, isOver } = useDocDropTarget(dropId ?? '__noop__')
  return (
    <div
      ref={dropId ? setNodeRef : undefined}
      data-doc-drop={dropId}
      style={depth > 0 ? { paddingLeft: `${8 + Math.min(depth, 4) * 12}px` } : undefined}
      className={cn(
        dropId && isOver && 'ring-2 ring-primary bg-primary-soft',
        'group flex items-center gap-1 h-8 px-2 rounded-[8px] text-[13px] transition-colors',
        active ? 'bg-primary-soft text-primary font-medium' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
      )}
    >
      {hasChildren && onToggleExpand ? (
        <button
          type="button"
          aria-label={expanded ? '折叠子文件夹' : '展开子文件夹'}
          onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
          className="grid place-items-center w-4 h-4 rounded hover:bg-surface-2 shrink-0 cursor-pointer"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : null}
      <button type="button" onClick={onClick} className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer h-full">
        <Icon size={14} className="shrink-0" />
        <span className="truncate flex-1">{label}</span>
        <span className="text-[11px] tabular-nums opacity-60">{count}</span>
      </button>
      {onCreateChild && (
        <button
          type="button"
          title="新建子文件夹"
          aria-label={`在「${label}」下新建子文件夹`}
          onClick={(e) => { e.stopPropagation(); onCreateChild() }}
          className="grid place-items-center w-5 h-5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-2 text-on-surface-2 hover:text-on-surface transition-opacity cursor-pointer"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  )
}
