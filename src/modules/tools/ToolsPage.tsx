import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { RotateCcw } from 'lucide-react'
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
        ? 'bg-danger/10 text-danger'
        : job?.phase === 'running'
          ? 'bg-primary-soft text-primary'
          : 'bg-surface-3 text-on-surface-2'
      return { text: fanqieBadge, tone }
    }
    if (t.nativeOnly && !nativeClient) {
      return { text: '仅客户端', tone: 'bg-surface-3 text-on-surface-2' }
    }
    if (!t.badge) return { tone: '' }
    return {
      text: t.badge,
      tone: t.offline ? 'bg-ok/10 text-ok' : 'bg-primary-soft text-primary',
    }
  }

  const toolCard = (t: ToolEntry, overlay = false) => {
    const badge = badgeFor(t)
    return (
      <Link
        to={t.to}
        draggable={false}
        tabIndex={overlay ? -1 : undefined}
        aria-label={t.title}
        className="chrome-button press card flex flex-col justify-between gap-2.5 relative w-full min-h-[104px] p-3.5 select-none"
      >
        <span className="flex items-center justify-between gap-2 w-full">
          <span className="grid place-items-center size-9 rounded-[10px] bg-primary-soft text-primary shrink-0">
            <t.icon size={20} />
          </span>
          {badge.text && (
            <span className={cn('px-2 py-0.5 rounded-full text-[10.5px] font-medium leading-4 truncate max-w-[116px]', badge.tone)}>
              {badge.text}
            </span>
          )}
        </span>
        <span className="min-w-0 w-full">
          <span className="block text-[14px] font-semibold leading-5 truncate">{t.title}</span>
          <span className="block text-[11.5px] leading-4 mt-0.5 truncate text-on-surface-2">{t.sub}</span>
        </span>
      </Link>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 md:pt-6 pb-24 md:pb-14 flex flex-col gap-5">
      <h1 className="hidden md:block text-[28px] font-semibold leading-tight tracking-tight">工具</h1>

      <IntelligenceCard />

      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-[13px] font-semibold text-on-surface-2 shrink-0">小工具</h2>
            <Segmented
              size="sm"
              ariaLabel="按分类筛选工具"
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
            />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-on-surface-2 ml-auto">
            {hasSavedOrder && (
              <button
                type="button"
                onClick={resetOrder}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-primary hover:bg-primary-soft/60 transition-colors cursor-pointer"
              >
                <RotateCcw size={11} aria-hidden /> 重置排序
              </button>
            )}
            <span>长按拖动排序</span>
          </div>
        </div>
        <DragSort
          ids={tools.map((t) => t.to)}
          strategy={rectSwappingStrategy}
          onMove={moveTool}
          renderOverlay={(id) => {
            const tool = tools.find((t) => t.to === id)
            return tool ? (
              <div aria-hidden="true" className="h-full overflow-hidden rounded-[14px] shadow-xl ring-1 ring-primary/15">
                {toolCard(tool, true)}
              </div>
            ) : null
          }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
