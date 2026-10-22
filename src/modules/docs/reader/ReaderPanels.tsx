import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowUpRight, Bookmark, ChevronLeft, ChevronRight, Highlighter, List,
  LocateFixed, MessageSquareText, Plus, Trash2, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Annotation, Doc, Task } from '@/db/db'
import { db } from '@/db/db'
import { useDocTabs } from '@/stores/tabs'
import { cn } from '@/lib/cn'
import { fmtListDate } from '@/lib/date'
import type { TocItem } from '../PdfReader'
import { FLOW_KINDS, annotationAnchor, highlightLocator } from './locator'
import { annotationColorClass, HL_COLORS } from './types'

/**
 * 阅读器侧栏与小组件（从 DocReaderPage 抽出，纯展示、无业务状态）。
 * 目录 / 高亮 / 书签 / 批注 / 反链都在这里，页面只管把数据与回调传进来。
 */

/** 多标签栏：关一个自动切邻居；仅剩一个时不显示 */
export function TabBar({ docId, onJump }: { docId?: string; onJump: (id: string) => void }) {
  const tabs = useDocTabs((s) => s.tabs)
  const closeTab = useDocTabs((s) => s.close)
  if (tabs.length < 2) return null
  return (
    <div className="shrink-0 flex items-stretch gap-1 px-2 pt-1.5 overflow-x-auto border-b border-outline/60 bg-surface">
      {tabs.map((t) => {
        const active = t.id === docId
        return (
          <div
            key={t.id}
            className={cn(
              'group flex items-center gap-1.5 pl-3 pr-1.5 h-9 rounded-t-[10px] cursor-pointer select-none shrink-0 max-w-[180px] transition-colors',
              active ? 'bg-surface-2 text-on-surface' : 'text-on-surface-2 hover:bg-surface-3/70',
            )}
            onClick={() => onJump(t.id)}
          >
            <span className={cn('text-[12px] truncate', active && 'font-medium')}>{t.title}</span>
            <button
              aria-label={`关闭标签 ${t.title}`}
              onClick={(e) => {
                e.stopPropagation()
                const neighbor = closeTab(t.id)
                if (t.id === docId) {
                  if (neighbor) onJump(neighbor)
                  else window.location.hash = '#/docs'
                }
              }}
              className="grid place-items-center w-5 h-5 rounded-md opacity-40 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function IconBtn({
  children, label, onClick, className = '', active = false,
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  className?: string
  active?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid place-items-center shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] md:rounded-[12px] transition-colors cursor-pointer ${active ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface'} ${className}`}
    >
      {children}
    </button>
  )
}

type PanelTabOption<V extends string> = { value: V; label: string; count?: number }

/** 侧栏页签：轻量胶囊 + 计数，右侧留折叠按钮（抽屉里不传 collapse） */
export function PanelHead<V extends string>({
  value, onChange, tabs, collapse, className,
}: {
  value: V
  onChange: (v: V) => void
  tabs: PanelTabOption<V>[]
  collapse?: { side: 'left' | 'right'; onCollapse: () => void }
  className?: string
}) {
  const CollapseIcon = collapse?.side === 'left' ? ChevronLeft : ChevronRight
  return (
    <div className={cn('shrink-0 flex items-center gap-1 h-11 px-2.5 border-b border-outline/60', className)}>
      <div role="tablist" aria-label="面板切换" className="flex items-center gap-0.5 min-w-0">
        {tabs.map((t) => {
          const active = t.value === value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cn(
                'h-7 px-2.5 rounded-[8px] text-[12.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer',
                active
                  ? 'bg-surface text-on-surface shadow-sm'
                  : 'text-on-surface-2 hover:text-on-surface hover:bg-surface-3/60',
              )}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn(
                  'min-w-[16px] h-4 px-1 rounded-full grid place-items-center text-[10px] leading-none tabular-nums',
                  active ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-on-surface-2',
                )}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {collapse && (
        <button
          type="button"
          aria-label={collapse.side === 'left' ? '收起目录栏' : '收起批注栏'}
          title="收起侧栏"
          onClick={collapse.onCollapse}
          className="ml-auto shrink-0 grid place-items-center w-7 h-7 rounded-[8px] text-on-surface-2 hover:text-on-surface hover:bg-surface-3/70 transition-colors cursor-pointer"
        >
          <CollapseIcon size={15} />
        </button>
      )}
    </div>
  )
}

/** 可拖拽分隔线：命中区 ±4px，双击复位；键盘 ←/→ 按 16px 步进（Shift 32px） */
export function PanelSplitter({
  side, width, min, max, label, ...rest
}: React.ComponentProps<'div'> & {
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  label: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="拖动调节宽度，双击恢复默认"
      className={cn('reader-splitter', side === 'left' ? 'hidden lg:block' : 'hidden xl:block')}
      {...rest}
    />
  )
}

export function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-medium text-on-surface-2">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`减小${label}`} className="touch-target w-7 h-7 rounded-lg bg-surface-3 text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={onMinus}>−</button>
        <span className="text-[13px] font-medium w-12 text-center tabular-nums">{value}</span>
        <button type="button" aria-label={`增大${label}`} className="touch-target w-7 h-7 rounded-lg bg-surface-3 text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={onPlus}>+</button>
      </div>
    </div>
  )
}

/* ---------- 左栏内容 ---------- */

export function TocContent({
  doc, toc, mdHeadings, annotations, leftTab, currentLocator, onJump, onDeleteBookmark,
}: {
  doc: Doc
  toc: TocItem[]
  mdHeadings: { level: number; text: string; blockIdx: number }[]
  annotations: Annotation[]
  leftTab: 'toc' | 'marks'
  currentLocator: string
  onJump: (anchor: string, hl?: string) => void
  onDeleteBookmark: (id: string) => void
}) {
  const marks = useLiveQueryBookmarks(doc.hash)
  const currentNum = currentLocator ? Number(currentLocator.slice(1)) : NaN

  // 当前章节 = 最后一个「已经到达」的目录项；还没滚动过时默认第一章，避免目录全灰
  const activeIndex = useMemo(() => {
    if (leftTab !== 'toc' || toc.length === 0) return -1
    if (!Number.isFinite(currentNum)) return 0
    let idx = 0
    for (let i = 0; i < toc.length; i++) {
      if (doc.kind === 'pdf' ? toc[i].page <= currentNum : toc[i].page - 1 <= currentNum) idx = i
    }
    return idx
  }, [leftTab, doc.kind, toc, currentNum])

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0">
      {leftTab === 'toc' ? (
        doc.kind === 'pdf' ? (
          toc.length > 0 ? (
            <TocList
              items={toc}
              activeIndex={activeIndex}
              anchor={(item) => `p${item.page}`}
              badge={(item) => String(item.page)}
              onJump={onJump}
            />
          ) : (
            <PanelEmpty icon={List} title="没有书签大纲" hint="这份 PDF 没有内置目录，可以用书签记位置。" />
          )
        ) : FLOW_KINDS.includes(doc.kind) ? (
          toc.length > 1 ? (
            <TocList
              items={toc}
              activeIndex={activeIndex}
              anchor={(item) => `f${item.page - 1}`}
              badge={(item) => String(item.page)}
              onJump={onJump}
            />
          ) : (
            <PanelEmpty icon={List} title="没有章节结构" hint="这份文档没有可解析的章节，直接滚动阅读即可。" />
          )
        ) : (
          <MdToc
            headings={mdHeadings}
            currentBlock={currentLocator.startsWith('b') ? Number(currentLocator.slice(1)) : null}
            onJump={onJump}
          />
        )
      ) : annotations.length === 0 ? (
        <PanelEmpty icon={Highlighter} title="还没有高亮" hint="划选正文，点浮条上的颜色即可高亮。" />
      ) : (
        <ul className="py-1.5">
          {annotations.map((a) => {
            const locator = highlightLocator(doc, a)
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onJump(annotationAnchor(doc, a), a.id)}
                  className="relative w-full text-left rounded-[9px] pl-3 pr-2 py-2 hover:bg-surface-3/60 transition-colors cursor-pointer flex gap-2"
                >
                  <span className={cn('absolute left-0.5 top-2 bottom-2 w-[2.5px] rounded-full', annotationColorClass(a))} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] leading-[1.55] line-clamp-3">{a.text}</span>
                    {(locator || a.comment) && (
                      <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-on-surface-2">
                        {locator && <span className="tabular-nums">{locator}</span>}
                        {a.comment && <MessageSquareText size={10} className="shrink-0" />}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {marks.length > 0 && (
        <BookmarkList marks={marks} onJump={onJump} onDelete={onDeleteBookmark} />
      )}
    </div>
  )
}

// 目录里的高亮跳转需要同一个定位规则，这里从 locator 取，避免两处各写一份

/** PDF / 流式文档目录共用：当前章节着色 + 自动滚入视野 */
function TocList({
  items, activeIndex, anchor, badge, onJump,
}: {
  items: TocItem[]
  activeIndex: number
  anchor: (item: TocItem) => string
  badge: (item: TocItem) => string
  onJump: (anchor: string) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (activeIndex >= 0) activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <nav className="py-1.5" aria-label="文档目录">
      {items.map((item, i) => {
        const active = i === activeIndex
        return (
          <button
            key={`${item.page}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onJump(anchor(item))}
            className={cn(
              'group w-full flex items-start gap-2 text-left rounded-[9px] py-[7px] pr-2 transition-colors cursor-pointer',
              active ? 'bg-primary-soft/70 text-on-surface' : 'text-on-surface-2 hover:bg-surface-3/60 hover:text-on-surface',
            )}
            style={{ paddingLeft: 10 + Math.min(item.level, 4) * 12 }}
          >
            <span className={cn('shrink-0 mt-[6px] w-1.5 h-1.5 rounded-full transition-colors', active ? 'bg-primary' : 'bg-outline group-hover:bg-on-surface-2/50')} />
            <span className={cn('flex-1 min-w-0 text-[12.5px] leading-[1.55] line-clamp-2', active && 'font-medium')}>{item.title}</span>
            <span className={cn('shrink-0 mt-[2px] text-[10.5px] tabular-nums', active ? 'text-primary' : 'text-on-surface-2/75')}>{badge(item)}</span>
          </button>
        )
      })}
    </nav>
  )
}

function BookmarkList({
  marks, onJump, onDelete,
}: {
  marks: { id: string; label: string; anchor: string; quote?: string }[]
  onJump: (anchor: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="mt-2 border-t border-outline/60 pt-2" aria-label="书签">
      <div className="flex items-center gap-1.5 px-2.5 pt-0.5 pb-1 text-[11px] font-medium text-on-surface-2">
        <Bookmark size={12} />
        <span>书签</span>
        <span className="tabular-nums opacity-70">{marks.length}</span>
      </div>
      {marks.map((b) => (
        <div key={b.id} className="group flex items-start gap-1.5 rounded-[9px] pl-2.5 pr-1.5 py-1.5 hover:bg-surface-3/60 transition-colors">
          <button type="button" className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => onJump(b.anchor)}>
            <span className="block text-[12.5px] leading-snug">{b.label}</span>
            {b.quote && <span className="block mt-0.5 text-[11px] leading-snug text-on-surface-2 line-clamp-2">{b.quote}</span>}
          </button>
          <button
            type="button"
            aria-label="删除书签"
            onClick={() => onDelete(b.id)}
            className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 text-on-surface-2 hover:text-danger transition-opacity cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </section>
  )
}

export function PanelEmpty({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="grid place-items-center text-center px-4 py-12">
      <div className="grid place-items-center w-11 h-11 rounded-[14px] bg-surface-3/60 text-on-surface-2 mb-3">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <p className="text-[12.5px] font-medium">{title}</p>
      <p className="text-[11.5px] text-on-surface-2 leading-relaxed mt-1 max-w-[210px]">{hint}</p>
    </div>
  )
}

/** MD 目录：标题由页面加载时一并解析，不再二次读文件 */
function MdToc({
  headings, currentBlock, onJump,
}: {
  headings: { level: number; text: string; blockIdx: number }[]
  currentBlock: number | null
  onJump: (anchor: string, hl?: string) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const activeIndex = useMemo(() => {
    if (currentBlock == null) return headings.length > 0 ? 0 : -1
    let idx = 0
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].blockIdx <= currentBlock) idx = i
    }
    return idx
  }, [headings, currentBlock])

  useEffect(() => {
    if (activeIndex >= 0) activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!headings.length) {
    return <PanelEmpty icon={List} title="没有标题" hint="在 Markdown 里用 # 写标题，目录会自动生成。" />
  }
  return (
    <nav className="py-1.5" aria-label="标题目录">
      {headings.map((h, i) => {
        const active = i === activeIndex
        const levelClass = h.level === 1 ? 'text-[13px] font-semibold' : h.level === 2 ? 'text-[12.5px]' : 'text-[12px]'
        return (
          <button
            key={`${h.blockIdx}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onJump(`b${h.blockIdx}`)}
            className={cn(
              'group w-full flex items-start gap-2 text-left rounded-[9px] py-[7px] pr-2 transition-colors cursor-pointer',
              active ? 'bg-primary-soft/70 text-on-surface' : 'text-on-surface-2 hover:bg-surface-3/60 hover:text-on-surface',
            )}
            style={{ paddingLeft: 10 + Math.min(h.level - 1, 3) * 12 }}
          >
            <span className={cn('shrink-0 mt-[6px] w-1.5 h-1.5 rounded-full transition-colors', active ? 'bg-primary' : 'bg-outline group-hover:bg-on-surface-2/50')} />
            <span className={cn('flex-1 min-w-0 leading-[1.55] line-clamp-2', levelClass)}>{h.text}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ---------- 右栏内容 ---------- */

export function RightContent({
  annotations, backlinks, rightTab, onJump, onToTask, onDelete, onRecolor, onComment, docId, anchorFor,
}: {
  annotations: Annotation[]
  backlinks: Task[]
  rightTab: 'anns' | 'backlinks'
  onJump: (anchor: string, hl?: string) => void
  onToTask: (ann: Annotation) => void
  onDelete: (id: string) => void
  onRecolor: (id: string, color: Annotation['color']) => void
  onComment: (id: string, comment?: string) => void
  docId?: string
  anchorFor: (a: Annotation) => string
}) {
  const [editing, setEditing] = useState<string | null>(null)

  if (rightTab === 'backlinks') {
    return (
      <div className="flex-1 overflow-y-auto px-2.5 pb-4 min-h-0">
        {backlinks.length === 0 ? (
          <PanelEmpty
            icon={ArrowUpRight}
            title="暂无引用"
            hint={docId ? '在批注上点「转任务」，或从任务详情挂载本文档，反链会显示在这里。' : '还没有任务引用本文档。'}
          />
        ) : (
          <>
            <p className="text-[11px] text-on-surface-2 px-1.5 pt-2.5 pb-2 tabular-nums">{backlinks.length} 个任务引用了本文档</p>
            <div className="flex flex-col gap-2">
              {backlinks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    window.location.hash = `#/tasks?tier=${t.tier}&focus=${t.id}`
                  }}
                  className="group w-full text-left rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 hover:border-primary/30 hover:-translate-y-px transition-[border-color,transform] cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                    <p className="flex-1 text-[12.5px] font-medium leading-snug line-clamp-2">{t.title}</p>
                    <ArrowUpRight size={13} className="shrink-0 mt-0.5 text-on-surface-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-[10.5px] text-on-surface-2 mt-1 pl-3.5">
                    {t.tier === 'today' ? '今日' : t.tier === 'upcoming' ? '近期' : t.tier === 'anytime' ? '随时' : '将来'} · {t.status === 'doing' ? '进行中' : '待办'}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-2.5 pb-4 min-h-0">
      {annotations.length === 0 ? (
        <PanelEmpty icon={Highlighter} title="还没有批注" hint="划选正文 → 选颜色高亮 → 高亮可加评论、一键转任务。" />
      ) : (
        <div className="pt-2 flex flex-col gap-2">
          <p className="text-[11px] text-on-surface-2 px-1.5 pb-0.5 tabular-nums">{annotations.length} 条批注</p>
          {annotations.map((a) => (
            <article key={a.id} className="group relative rounded-[12px] border border-outline bg-surface-2 overflow-hidden transition-colors hover:border-primary/30">
              <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', annotationColorClass(a))} aria-hidden />
              <div className="pl-3 pr-2.5 py-2.5">
                {a.kind === 'shot' && a.img && (
                  <button
                    type="button"
                    onClick={() => onJump(anchorFor(a), a.id)}
                    className="block w-full mb-2 cursor-zoom-in"
                    aria-label="跳到截图所在页"
                  >
                    <img src={a.img} alt="区域截图" className="w-full rounded-[8px] border border-outline/70" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onJump(anchorFor(a), a.id)}
                  title="跳到原文位置"
                  className="w-full text-left cursor-pointer"
                >
                  <span className="block text-[12.5px] leading-[1.6] text-on-surface line-clamp-4">{a.text}</span>
                </button>
                {a.comment && editing !== a.id && (
                  <p className="mt-1.5 ml-0.5 pl-2 border-l-2 border-outline/70 text-[11.5px] leading-relaxed text-on-surface-2">{a.comment}</p>
                )}
                {editing === a.id ? (
                  <textarea
                    autoFocus
                    defaultValue={a.comment ?? ''}
                    rows={2}
                    placeholder="写下评论…"
                    onBlur={(e) => {
                      onComment(a.id, e.target.value.trim() || undefined)
                      setEditing(null)
                    }}
                    className="mt-1.5 w-full rounded-[8px] bg-surface-2 border border-outline px-2.5 py-1.5 text-[12.5px] outline-none focus:border-primary/60 resize-none"
                  />
                ) : null}
                <div className="ann-actions mt-2 pt-1.5 border-t border-outline/60 flex items-center gap-0.5 -ml-1">
                  {a.kind !== 'shot' && HL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`改为${c}`}
                      onClick={() => onRecolor(a.id, c)}
                      className={`w-[18px] h-[18px] rounded-full hl-${c} border ${a.color === c ? 'border-on-surface' : 'border-outline/50'} cursor-pointer`}
                    />
                  ))}
                  {a.kind !== 'shot' && <span className="w-px h-3.5 bg-outline mx-1" />}
                  <MiniBtn label="评论" onClick={() => setEditing(editing === a.id ? null : a.id)}><MessageSquareText size={13} /></MiniBtn>
                  <MiniBtn label="定位" onClick={() => onJump(anchorFor(a), a.id)}><LocateFixed size={13} /></MiniBtn>
                  <MiniBtn label="转任务" onClick={() => onToTask(a)}><Plus size={13} /></MiniBtn>
                  <MiniBtn label="删除" danger onClick={() => onDelete(a.id)}><Trash2 size={13} /></MiniBtn>
                  <span className="ml-auto text-[10.5px] text-on-surface-2 pr-1 tabular-nums">
                    {fmtListDate(a.createdAt)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function MiniBtn({ children, label, onClick, danger = false }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid place-items-center w-7 h-7 rounded-lg hover:bg-surface-3 cursor-pointer ${danger ? 'text-on-surface-2 hover:text-danger' : 'text-on-surface-2 hover:text-on-surface'}`}
    >
      {children}
    </button>
  )
}

/* 书签 live query（局部 hook） */
function useLiveQueryBookmarks(docHash: string) {
  return (
    useLiveQuery(
      () => db.bookmarks.where('docHash').equals(docHash).reverse().sortBy('createdAt'),
      [docHash],
      [] as { id: string; label: string; anchor: string; quote?: string; createdAt: number }[],
    ) ?? []
  )
}
