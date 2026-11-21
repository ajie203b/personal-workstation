import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, RotateCcw } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { arraySwap, rectSwappingStrategy } from '@dnd-kit/sortable'
import { db } from '@/db/db'
import { IntelligenceCard } from '@/modules/intelligence/IntelligenceCard'
import { useFanqie } from '@/stores/fanqie'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { isNative, isTauri } from '@/lib/native'
import { DragSort, DragSortItem } from '@/shared/ui/DragSort'
import { Segmented } from '@/shared/ui/Segmented'
import { ToolIconTile } from '@/shared/ui/ToolIconTile'
import { TOOL_CATALOG, type ToolCategory, type ToolEntry } from './toolCatalog'
import { orderTools } from './toolOrder'

type FilterCategory = 'all' | ToolCategory

const CATEGORY_OPTIONS: { value: FilterCategory; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'doc', label: '文档' },
  { value: 'media', label: '媒体' },
  { value: 'utility', label: '效率' },
]

export function ToolsPage() {
  const localBooks = useLiveQuery(() => db.fanqieBooks.count(), []) ?? 0
  const job = useFanqie((s) => s.job)
  const savedOrder = useLiveQuery(() => db.settings.get('toolOrder'), [])
  // 拖拽落位先改本地顺序，再后台落库：否则会先弹回旧位置、等 liveQuery 回来才跳过去
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const [category, setCategory] = useState<FilterCategory>('all')
  const nativeClient = isNative() || isTauri()

  const orderedAll = useMemo(
    () => orderTools(TOOL_CATALOG, localOrder ?? savedOrder?.value),
    [localOrder, savedOrder?.value],
  )
  const tools = useMemo(
    () => (category === 'all' ? orderedAll : orderedAll.filter((t) => t.category === category)),
    [orderedAll, category],
  )

  useEffect(() => {
    if (!localOrder) return
    const saved = Array.isArray(savedOrder?.value) ? (savedOrder.value as string[]) : null
    if (saved && saved.length === localOrder.length && saved.every((id, i) => id === localOrder[i])) {
      setLocalOrder(null)
    }
  }, [savedOrder, localOrder])

  const hasSavedOrder = Boolean(
    localOrder || (Array.isArray(savedOrder?.value) && savedOrder.value.length > 0),
  )

  const moveTool = (active: string, over: string) => {
    const ids = orderedAll.map((t) => t.to)
    const from = ids.indexOf(active)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const next = arraySwap(ids, from, to)
    setLocalOrder(next)
    void db.settings.put({ key: 'toolOrder', value: next }).catch(() => {
      setLocalOrder(null)
      useUi.getState().toast('排序保存失败，请重试')
    })
  }

  const resetOrder = () => {
    setLocalOrder(null)
    void db.settings.delete('toolOrder')
      .then(() => useUi.getState().toast('已恢复默认排序'))
      .catch(() => useUi.getState().toast('重置排序失败，请重试'))
  }

  const fanqieBadge = job?.phase === 'running'
    ? `下载中 ${job.done}/${job.total}`
    : job?.phase === 'paused'
      ? '已暂停'
      : job?.phase === 'error'
        ? '下载中断'
        : localBooks > 0
          ? `本地 ${localBooks} 本`
          : undefined

  const badgeFor = (t: ToolEntry): { text?: string; tone: string } => {
    if (t.to === '/tools/fanqie' && fanqieBadge) {
      const tone = job?.phase === 'error'
        ? 'bg-danger/12 text-danger'
        : job?.phase === 'running'
          ? 'bg-primary-soft text-primary'
          : 'bg-surface-3/90 text-on-surface-2'
      return { text: fanqieBadge, tone }
    }
    if (t.nativeOnly && !nativeClient) {
      return { text: '仅客户端', tone: 'bg-surface-3/90 text-on-surface-2' }
    }
    if (t.badge) {
      return {
        text: t.badge,
        tone: t.offline ? 'bg-ok/12 text-ok' : 'bg-primary-soft/80 text-primary',
      }
    }
    return { tone: '' }
  }

  const toolCard = (t: ToolEntry, overlay = false) => {
    const badge = badgeFor(t)
    return (
      <Link
        to={t.to}
        draggable={false}
        tabIndex={overlay ? -1 : undefined}
        aria-label={t.title}
        style={{ '--tool-tint': t.tint } as CSSProperties}
        className={cn(
          'tool-bento-card flex h-full w-full select-none',
          'flex-col items-start gap-2 p-3 rounded-[18px] min-h-[112px]',
          'sm:flex-row sm:items-center sm:gap-3.5 sm:px-4 sm:py-3.5 sm:rounded-[20px] sm:min-h-[94px]',
        )}
      >
        <div className="flex w-full items-start justify-between gap-1.5 sm:w-auto sm:block shrink-0">
          <ToolIconTile
            icon={t.icon}
            size="lg"
            className="max-sm:size-[42px] max-sm:rounded-[12px]"
          />
          {badge.text && (
            <span className={cn('sm:hidden rounded-full px-1.5 py-0.5 text-[9.5px] font-medium leading-none max-w-[84px] truncate', badge.tone)}>
              {badge.text}
            </span>
          )}
        </div>
        <span className="min-w-0 flex-1 w-full">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] sm:text-[15px] font-semibold tracking-[-0.01em] leading-snug text-on-surface max-sm:truncate max-sm:w-full">
              {t.title}
            </span>
            {badge.text && (
              <span className={cn('hidden sm:inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium leading-none', badge.tone)}>
                {badge.text}
              </span>
            )}
          </span>
          <span className="mt-0.5 sm:mt-1 block text-[11.5px] sm:text-[12.5px] leading-[1.38] sm:leading-[1.45] text-on-surface-2 line-clamp-2">
            {t.sub}
          </span>
        </span>
        <span aria-hidden className="tool-arrow hidden sm:grid">
          <ArrowUpRight size={15} strokeWidth={2} />
        </span>
      </Link>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-3.5 md:px-8 pt-3 md:pt-6 pb-24 md:pb-14 flex flex-col gap-5 md:gap-7 enter">
      <h1 className="sr-only">工具</h1>

      {/* 【写死规则】排行榜永远独立置顶于最上方，不属于「小工具」，不参与分类与排序。 */}
      <IntelligenceCard />

      <section aria-labelledby="tool-directory-heading" data-tool-directory="true" className="flex flex-col gap-3 md:gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-baseline gap-2">
            <h2 id="tool-directory-heading" className="text-[19px] md:text-[22px] font-bold tracking-[-0.025em] leading-tight">
              小工具
            </h2>
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-surface-3/90 text-[11px] font-semibold tabular-nums text-on-surface-2">
              {tools.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              touchSized
              ariaLabel="按分类筛选工具"
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
            />
            <div className="flex items-center gap-2 text-[12px] text-on-surface-2">
              {hasSavedOrder && (
                <button
                  type="button"
                  onClick={resetOrder}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-primary bg-primary-soft/60 hover:bg-primary-soft transition-colors cursor-pointer"
                >
                  <RotateCcw size={11} aria-hidden /> 重置排序
                </button>
              )}
              <span className="hidden sm:inline">长按拖动排序</span>
            </div>
          </div>
        </div>

        <DragSort
          ids={tools.map((t) => t.to)}
          strategy={rectSwappingStrategy}
          onMove={moveTool}
          renderOverlay={(id) => {
            const tool = tools.find((t) => t.to === id)
            return tool ? (
              <div aria-hidden="true" className="h-full overflow-hidden rounded-[18px] sm:rounded-[20px] shadow-2xl ring-2 ring-primary/25">
                {toolCard(tool, true)}
              </div>
            ) : null
          }}
        >
          <div key={category} className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 sm:gap-3 cascade">
            {tools.map((t) => (
              <DragSortItem key={t.to} id={t.to} label={t.title} className="w-full min-w-0">
                {toolCard(t)}
              </DragSortItem>
            ))}
          </div>
        </DragSort>
      </section>
    </div>
  )
}
