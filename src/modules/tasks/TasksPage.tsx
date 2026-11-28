import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarDays, Columns3, FileText, Filter, Grid2x2, List, Search, X } from 'lucide-react'
import { PRIORITY_VAR, TIERS, TIER_LABEL, type Priority, type Tier } from '@/db/db'
import { useAllTasks, deriveDone, deriveToday } from '@/db/hooks'
import { sortTasks } from '@/db/tasks'
import { checkInWithUndo, toggleTaskWithUndo } from './taskActions'
import { useTasksUi } from '@/stores/tasks'
import { QuickAdd } from './QuickAdd'
import { TaskList } from './TaskList'
import { filterTasks } from './taskTemplates'
import { Segmented } from '@/shared/ui/Segmented'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { PageSkeleton } from '@/shared/ui/Skeleton'
import { fmtListDate, todayStr } from '@/lib/date'
import { cn } from '@/lib/cn'

// 重依赖视图按需分包：@dnd-kit 仅看板使用，列表视图首屏不下载
const BoardView = lazy(() => import('./BoardView').then((m) => ({ default: m.BoardView })))
const CalendarView = lazy(() => import('./CalendarView').then((m) => ({ default: m.CalendarView })))
const QuadrantView = lazy(() => import('./QuadrantView').then((m) => ({ default: m.QuadrantView })))
const LogbookView = lazy(() => import('./LogbookView').then((m) => ({ default: m.LogbookView })))

type View = 'list' | 'board' | 'calendar' | 'quadrant'

/**
 * 任务清单：四清单 × 四视图（列表/看板/日历/四象限）+ NLP 录入 + Logbook。
 * tier/view 走 URL 参数，支持深链互跳（/tasks?tier=today&view=board）。
 */
export function TasksPage() {
  const [params, setParams] = useSearchParams()
  const all = useAllTasks()
  const setFocusId = useTasksUi((s) => s.setFocusId)
  const openDetail = useTasksUi((s) => s.openDetail)
  const today = todayStr()

  // 深链定位：/tasks?focus=:id
  const focusParam = params.get('focus')
  useEffect(() => {
    if (focusParam) {
      setFocusId(focusParam)
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('focus')
        return next
      }, { replace: true })
    }
  }, [focusParam, setFocusId, setParams])

  const tierParam = params.get('tier')
  const isLogbook = tierParam === 'logbook'
  const tier: Tier = (TIERS as readonly string[]).includes(tierParam ?? '') ? (tierParam as Tier) : 'today'
  const viewParam = params.get('view')
  const view: View = (['list', 'board', 'calendar', 'quadrant'] as const).includes(viewParam as View) ? (viewParam as View) : 'list'

  const [filterOpen, setFilterOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState<'all' | Priority>('all')
  const [filterTag, setFilterTag] = useState('')
  const [onlyWithDoc, setOnlyWithDoc] = useState(false)

  const allTaskTags = useMemo(() => {
    const set = new Set<string>()
    for (const t of all) if (t.status !== 'done') for (const tag of t.tags) set.add(tag)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [all])

  const hasTaskFilter = Boolean(filterQuery.trim() || filterPriority !== 'all' || filterTag || onlyWithDoc)
  const filteredAll = useMemo(
    () => filterTasks(all, { query: filterQuery, priority: filterPriority, tag: filterTag, onlyWithDoc }),
    [all, filterQuery, filterPriority, filterTag, onlyWithDoc],
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of TIERS) c[t] = 0
    for (const task of filteredAll) if (task.status !== 'done') c[task.tier]++
    return c
  }, [filteredAll])
  const doneCount = useMemo(() => deriveDone(all).length, [all])

  const visible = useMemo(() => {
    if (isLogbook) return []
    if (tier === 'today') return sortTasks(deriveToday(filteredAll))
    return sortTasks(filteredAll.filter((t) => t.status !== 'done' && t.tier === tier))
  }, [filteredAll, tier, isLogbook])

  const clearTaskFilter = () => {
    setFilterQuery('')
    setFilterPriority('all')
    setFilterTag('')
    setOnlyWithDoc(false)
  }

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const openTask = (id: string) => { setFocusId(id); openDetail(id) }
  const completeTask = (t: typeof all[number]) => {
    if (t.repeat || (t.repeatCount ?? 1) > 1) void checkInWithUndo(t)
    else void toggleTaskWithUndo(t)
  }

  const emptyMap: Record<Tier, { title: string; hint: string }> = {
    today: { title: '今日暂无待办', hint: '从「随时」挑几件过来，或直接添加。完成的任务会自动归档进日志。' },
    upcoming: { title: '近期没有排期', hint: '添加时写「明天」「下周三」「10月8日」会自动进入这里。' },
    anytime: { title: '随时清单是空的', hint: '想到什么记什么，不设日期的任务都住在这里。' },
    someday: { title: '将来也许是空的', hint: '那些「说不定哪天会做」的想法，放这里最合适。' },
  }

  return (
    <div className={cn('mx-auto w-full px-3.5 md:px-8 pt-3 md:pt-4 pb-28 md:pb-14 flex flex-col gap-3 md:gap-4', view === 'board' ? 'max-w-[1600px]' : 'max-w-5xl')}>
      <div className="flex items-center gap-2 max-md:flex-wrap">
        <h1 className="hidden md:block text-[28px] font-semibold leading-tight tracking-tight shrink-0">任务清单</h1>

        {/* 手机：5 个页签横滚看不到边，改成自绘下拉；桌面仍是分段控件 */}
        <div className="md:hidden">
          <SelectMenu
            ariaLabel="切换清单"
            title="切换清单"
            value={isLogbook ? 'logbook' : tier}
            onChange={(v) => setParam('tier', v)}
            triggerClassName="h-[38px] rounded-[12px] text-[13.5px] font-semibold bg-surface/90 shadow-[var(--elev-card)]"
            options={[
              ...TIERS.map((t) => ({ value: t as string, label: `${TIER_LABEL[t]}（${counts[t] ?? 0}）` })),
              { value: 'logbook', label: `日志（${doneCount}）` },
            ]}
          />
        </div>

        {!isLogbook && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label="筛选任务"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((v) => !v)}
              className={cn(
                'relative inline-flex items-center gap-1.5 h-[36px] px-2.5 rounded-[11px] border text-[12.5px] font-medium transition-colors cursor-pointer',
                filterOpen || hasTaskFilter
                  ? 'border-primary/50 bg-primary-soft text-primary'
                  : 'border-outline bg-surface/90 text-on-surface-2 hover:text-on-surface',
              )}
            >
              <Filter size={14} />
              <span className="hidden sm:inline">筛选</span>
              {hasTaskFilter && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
            </button>
            <Segmented
              size="sm"
              touchSized
              showLabels
              className="max-md:[&>button]:justify-center max-md:[&>button]:px-2 max-md:[&_svg]:hidden"
              ariaLabel="视图切换"
              value={view}
              onChange={(v) => setParam('view', v)}
              options={[
                { value: 'list', label: '列表', icon: List },
                { value: 'board', label: '看板', icon: Columns3 },
                { value: 'calendar', label: '日历', icon: CalendarDays },
                { value: 'quadrant', label: '四象限', icon: Grid2x2 },
              ]}
            />
          </div>
        )}
        {isLogbook && (
          <button
            type="button"
            onClick={() => setParam('tier', 'today')}
            className="ml-auto text-[13px] text-on-surface-2 hover:text-on-surface cursor-pointer"
          >
            返回清单
          </button>
        )}
      </div>

      {/* 多维筛选条（关键词 / 优先级 / 标签 / 关联文档） */}
      {!isLogbook && (filterOpen || hasTaskFilter) && (
        <div className="card px-3.5 py-2.5 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={13.5} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-2/75" />
            <input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="筛选标题、备注或子任务…"
              aria-label="筛选任务关键词"
              className="w-full h-8 pl-8 pr-7 rounded-[9px] bg-surface-2 border border-outline text-[12.5px] outline-none focus:border-primary/60"
            />
            {filterQuery && (
              <button
                type="button"
                aria-label="清空任务关键词"
                onClick={() => setFilterQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center size-5 rounded-full text-on-surface-2 hover:bg-surface-3 cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="inline-flex items-center gap-1" role="group" aria-label="按优先级筛选">
            {([0, 1, 2, 3] as const).map((p) => {
              const active = filterPriority === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFilterPriority((prev) => (prev === p ? 'all' : p))}
                  aria-pressed={active}
                  className={cn(
                    'h-7 px-2 rounded-[8px] border text-[11.5px] font-medium cursor-pointer transition-colors',
                    active ? 'border-transparent text-white' : 'border-outline bg-surface-2 text-on-surface-2 hover:text-on-surface',
                  )}
                  style={active ? { background: PRIORITY_VAR[p] } : undefined}
                >
                  P{p}
                </button>
              )
            })}
          </div>
          {allTaskTags.length > 0 && (
            <SelectMenu
              ariaLabel="按标签筛选"
              title="按标签筛选"
              value={filterTag}
              onChange={setFilterTag}
              triggerClassName="h-7 rounded-[8px] text-[12px]"
              options={[
                { value: '', label: '全部标签' },
                ...allTaskTags.map((tag) => ({ value: tag, label: `#${tag}` })),
              ]}
            />
          )}
          <button
            type="button"
            onClick={() => setOnlyWithDoc((v) => !v)}
            aria-pressed={onlyWithDoc}
            className={cn(
              'inline-flex items-center gap-1 h-7 px-2 rounded-[8px] border text-[11.5px] cursor-pointer transition-colors',
              onlyWithDoc ? 'border-primary/50 bg-primary-soft text-primary font-medium' : 'border-outline bg-surface-2 text-on-surface-2 hover:text-on-surface',
            )}
          >
            <FileText size={12} /> 含关联文档
          </button>
          {hasTaskFilter && (
            <button
              type="button"
              onClick={clearTaskFilter}
              className="ml-auto text-[12px] text-primary hover:underline cursor-pointer"
            >
              清空筛选
            </button>
          )}
        </div>
      )}

      {/* 所有视图共用同一个快速添加：看板 / 日历 / 四象限不再只能拖拽 */}
      {!isLogbook && (
        <div className="hidden md:block">
          <QuickAdd
            defaultTier={tier}
            placeholder={tier === 'today' ? '添加到今日…（明天14:00 交报告 P1 #工作）' : undefined}
          />
        </div>
      )}

      {/* 分级标签仅列表视图有语义（看板/日历/四象限展示全量任务，点击切换无效）；
          手机上由上面的下拉代替 */}
      {view === 'list' && !isLogbook && (
        <Segmented
          ariaLabel="清单切换"
          value={tier}
          onChange={(v) => setParam('tier', v)}
          options={[
            ...TIERS.map((t) => ({
              value: t as string,
              label: TIER_LABEL[t],
              badge: String(counts[t] ?? 0),
            })),
            { value: 'logbook', label: '日志', badge: String(doneCount) },
          ]}
          className="hidden md:inline-flex self-start max-w-full"
        />
      )}

      <div key={view} className="enter">
        <Suspense fallback={<PageSkeleton />}>
          {isLogbook ? (
            <LogbookView />
          ) : view === 'board' ? (
            <BoardView tasks={filteredAll} />
          ) : view === 'calendar' ? (
            <CalendarView tasks={filteredAll} onOpenTask={openTask} onToggleDone={completeTask} />
          ) : view === 'quadrant' ? (
            <QuadrantView tasks={filteredAll} onOpenTask={openTask} />
          ) : (
            <TaskList
              scope={`tasks-${tier}`}
              tier={tier}
              tasks={visible}
              emptyTitle={hasTaskFilter ? '没有符合筛选条件的任务' : emptyMap[tier].title}
              emptyHint={hasTaskFilter ? '调整或清空筛选条件即可查看全部待办。' : emptyMap[tier].hint}
            />
          )}
        </Suspense>
      </div>

      {!isLogbook && tier === 'today' && visible.length > 0 && (
        <p className="text-[12px] text-on-surface-2 px-1">
          今天 · {fmtListDate(today)}
          <span className="hidden md:inline"> · 按 ? 查看快捷键</span>
        </p>
      )}
    </div>
  )
}
