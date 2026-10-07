import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { TIERS, TIER_LABEL, type Tier } from '@/db/db'
import { useAllTasks, deriveDone, deriveToday } from '@/db/hooks'
import { sortTasks, toggleDone } from '@/db/tasks'
import { useTasksUi } from '@/stores/tasks'
import { QuickAdd } from './QuickAdd'
import { TaskList } from './TaskList'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { QuadrantView } from './QuadrantView'
import { LogbookView } from './LogbookView'
import { Segmented } from '@/shared/ui/Segmented'
import { todayStr } from '@/lib/date'

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

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of TIERS) c[t] = 0
    for (const task of all) if (task.status !== 'done') c[task.tier]++
    return c
  }, [all])
  const doneCount = useMemo(() => deriveDone(all).length, [all])

  const visible = useMemo(() => {
    if (isLogbook) return []
    if (tier === 'today') return sortTasks(deriveToday(all))
    return sortTasks(all.filter((t) => t.status !== 'done' && t.tier === tier))
  }, [all, tier, isLogbook])

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const openTask = (id: string) => { setFocusId(id); openDetail(id) }
  const completeTask = (t: typeof all[number]) => { void toggleDone(t) }

  const emptyMap: Record<Tier, { title: string; hint: string }> = {
    today: { title: '今天没有安排', hint: '从「随时池」拖几件过来，或直接添加。完成的一天会自动归档进日志。' },
    upcoming: { title: '近期没有排期', hint: '添加时写「明天」「下周三」「10月8日」会自动进入这里。' },
    anytime: { title: '随时池是空的', hint: '想到什么记什么，不设日期的任务都住在这里。' },
    someday: { title: '将来也许是空的', hint: '那些「说不定哪天会做」的想法，放这里最合适。' },
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h1 className="text-[22px] font-bold leading-8 shrink-0">任务清单</h1>
        {!isLogbook && (
          <div className="sm:ml-auto flex items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="视图切换"
              value={view}
              onChange={(v) => setParam('view', v)}
              options={[
                { value: 'list', label: '列表' },
                { value: 'board', label: '看板' },
                { value: 'calendar', label: '日历' },
                { value: 'quadrant', label: '四象限' },
              ]}
            />
          </div>
        )}
      </div>

      {view === 'list' && (
        <QuickAdd
          defaultTier={tier}
          placeholder={tier === 'today' ? '添加到今日…（明天14:00 交报告 P1 #工作）' : undefined}
        />
      )}

      {/* 分级标签仅列表视图有语义（看板/日历/四象限展示全量任务，点击切换无效） */}
      {view === 'list' && (
        <Segmented
          ariaLabel="清单切换"
          value={isLogbook ? 'logbook' : tier}
          onChange={(v) => setParam('tier', v)}
          options={[
            ...TIERS.map((t) => ({
              value: t as string,
              label: TIER_LABEL[t],
              badge: String(counts[t] ?? 0),
            })),
            { value: 'logbook', label: '日志', badge: String(doneCount) },
          ]}
          className="self-start max-w-full overflow-x-auto"
        />
      )}

      <div key={view} className="enter">
        {isLogbook ? (
          <LogbookView />
        ) : view === 'board' ? (
          <BoardView tasks={all} />
        ) : view === 'calendar' ? (
          <CalendarView tasks={all} onOpenTask={openTask} onToggleDone={completeTask} />
        ) : view === 'quadrant' ? (
          <QuadrantView tasks={all} onOpenTask={openTask} />
        ) : (
          <TaskList
            scope={`tasks-${tier}`}
            tasks={visible}
            emptyTitle={emptyMap[tier].title}
            emptyHint={emptyMap[tier].hint}
          />
        )}
      </div>

      {!isLogbook && tier === 'today' && visible.length > 0 && (
        <p className="text-[12px] text-on-surface-2 px-1">今天 · {today} · 按 ? 查看快捷键</p>
      )}
    </div>
  )
}
