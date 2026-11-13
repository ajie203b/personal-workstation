import type { Doc, DocKind, DocReadStatus, Folder } from '@/db/db'
import { UNFILED_FOLDER } from './DocDrag'

export const ALL_DOCS_VIEW = '__all__'
export const STARRED_VIEW = '__starred__'
export const RECENT_VIEW = '__recent__'
export const ANNOTATED_VIEW = '__annotated__'

export type DocSortKey = 'recent' | 'added' | 'title' | 'progress' | 'annotations'

export interface FolderTreeNode {
  folder: Folder
  children: FolderTreeNode[]
  depth: number
}

export function buildFolderTree(folders: readonly Folder[]): FolderTreeNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const childrenMap = new Map<string | undefined, Folder[]>()
  const sortFn = (a: Folder, b: Folder) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'zh-CN')

  for (const f of folders) {
    // 悬空 parentId 或直接自环均降级到根层级，避免 UI 消失
    const pid = f.parentId && f.parentId !== f.id && byId.has(f.parentId) ? f.parentId : undefined
    const list = childrenMap.get(pid) ?? []
    list.push(f)
    childrenMap.set(pid, list)
  }
  for (const list of childrenMap.values()) list.sort(sortFn)

  const seen = new Set<string>()
  const build = (parentId: string | undefined, depth: number): FolderTreeNode[] => {
    const items = childrenMap.get(parentId) ?? []
    const out: FolderTreeNode[] = []
    for (const folder of items) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)
      out.push({ folder, depth, children: build(folder.id, depth + 1) })
    }
    return out
  }

  const roots = build(undefined, 0)
  // 若旧数据存在环状 parentId，把它兜底挂回根级
  for (const f of folders) {
    if (!seen.has(f.id)) {
      seen.add(f.id)
      roots.push({ folder: f, depth: 0, children: build(f.id, 1) })
    }
  }
  return roots
}

export function collectSubtreeIds(rootId: string, folders: readonly Folder[]): Set<string> {
  const childrenMap = new Map<string, string[]>()
  for (const f of folders) {
    if (!f.parentId) continue
    const list = childrenMap.get(f.parentId) ?? []
    list.push(f.id)
    childrenMap.set(f.parentId, list)
  }
  const ids = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const childId of childrenMap.get(cur) ?? []) {
      if (!ids.has(childId)) {
        ids.add(childId)
        queue.push(childId)
      }
    }
  }
  return ids
}

export function folderPathName(folderId: string | undefined, folders: readonly Folder[]): string | undefined {
  if (!folderId) return undefined
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts: string[] = []
  let cur: string | undefined = folderId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const f = byId.get(cur)
    if (!f) break
    parts.unshift(f.name)
    cur = f.parentId
  }
  return parts.length ? parts.join(' / ') : undefined
}

export function effectiveReadStatus(doc: Doc, progressPct: number): DocReadStatus {
  if (doc.readStatus) return doc.readStatus
  if (progressPct >= 0.98) return 'done'
  if (progressPct > 0 || doc.lastOpenedAt) return 'reading'
  return 'unread'
}

export function filterAndSortDocs(input: {
  docs: readonly Doc[]
  view: string | null
  folders: readonly Folder[]
  kindFilter: DocKind | 'all'
  statusFilter: DocReadStatus | 'all'
  tagFilter: string
  annCountByHash: Record<string, number>
  progressMap: Record<string, { progressPct?: number }>
  sortBy: DocSortKey
  query: string
  textHits: Record<string, { count: number; snippet: string; seg?: number }>
}): Doc[] {
  const { docs, view, folders, kindFilter, statusFilter, tagFilter, annCountByHash, progressMap, sortBy, query, textHits } = input
  const activeView = view ?? ALL_DOCS_VIEW
  const subtree = activeView !== ALL_DOCS_VIEW
    && activeView !== STARRED_VIEW
    && activeView !== RECENT_VIEW
    && activeView !== ANNOTATED_VIEW
    && activeView !== UNFILED_FOLDER
    ? collectSubtreeIds(activeView, folders)
    : null

  const kw = query.trim().toLowerCase()
  const filtered = docs.filter((d) => {
    if (activeView === STARRED_VIEW && !d.starred) return false
    else if (activeView === RECENT_VIEW && !d.lastOpenedAt) return false
    else if (activeView === ANNOTATED_VIEW && (annCountByHash[d.hash] ?? 0) === 0) return false
    else if (activeView === UNFILED_FOLDER && d.folderId) return false
    else if (subtree && (!d.folderId || !subtree.has(d.folderId))) return false

    if (kindFilter !== 'all' && d.kind !== kindFilter) return false
    if (tagFilter && !(d.tags ?? []).includes(tagFilter)) return false
    if (statusFilter !== 'all') {
      const pct = progressMap[d.hash]?.progressPct ?? 0
      if (effectiveReadStatus(d, pct) !== statusFilter) return false
    }
    if (kw) {
      const inMeta = `${d.title} ${d.meta?.author ?? ''} ${d.meta?.venue ?? ''} ${d.meta?.year ?? ''} ${d.meta?.doi ?? ''} ${(d.tags ?? []).join(' ')}`.toLowerCase()
      const titleOrMetaHit = inMeta.includes(kw)
      const fulltextHit = (textHits[d.hash]?.count ?? 0) > 0
      if (!titleOrMetaHit && !fulltextHit) return false
    }
    return true
  })

  return filtered.sort((a, b) => {
    if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN')
    if (sortBy === 'added') return b.addedAt - a.addedAt
    if (sortBy === 'progress') {
      return (progressMap[b.hash]?.progressPct ?? 0) - (progressMap[a.hash]?.progressPct ?? 0) || b.addedAt - a.addedAt
    }
    if (sortBy === 'annotations') {
      return (annCountByHash[b.hash] ?? 0) - (annCountByHash[a.hash] ?? 0) || b.addedAt - a.addedAt
    }
    return (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt)
  })
}
