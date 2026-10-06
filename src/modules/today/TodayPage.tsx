import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { History, Keyboard, Plus, Sparkles } from 'lucide-react'
import { useAllTasks, useRecentDocs, useDateTick, deriveToday, deriveTodayDone } from '@/db/hooks'
import { sortTasks } from '@/db/tasks'
import { isThisWeek, fmtWeekdayLong, greeting, todayStr } from '@/lib/date'
import { AddTaskSheet } from '@/modules/tasks/AddTaskSheet'
import { TaskList } from '@/modules/tasks/TaskList'
import { useUi } from '@/stores/ui'
import { openDoc } from '@/shared/DeepLink'
import { FocusTimer } from '@/modules/focus/FocusTimer'

/** 今日 Dashboard：日期 + 加号添加 + 今日任务 + 进度 + 最近阅读 */
export function TodayPage() {
  const today = useDateTick()
  const all = useAllTasks()
  const todayTasks = useMemo(() => sortTasks(deriveToday(all, today)), [all, today])
  const todayDone = useMemo(() => deriveTodayDone(all, today), [all, today])
  const weekDone = useMemo(() => all.filter((t) => t.status === 'done' && isThisWeek(t.doneAt ?? 0)).length, [all])
  const totalDone = useMemo(() => all.filter((t) => t.status === 'done').length, [all])
  const openShortcuts = useUi((s) => s.setShortcutsOpen)
  const [addOpen, setAddOpen] = useState(false)
  useEffect(() => {
    const open = () => setAddOpen(true)
    window.addEventListener('ws:focus-quickadd', open)
    return () => window.removeEventListener('ws:focus-quickadd', open)
  }, [])

  const date = useMemo(() => new Date(), [today])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-5 enter">
      <header className="pt-1">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-on-surface-2">{greeting(date)}</p>
            <h1 className="text-[32px] md:text-[34px] font-bold leading-[40px] tracking-tight mt-0.5">
              {fmtWeekdayLong(date)}
            </h1>
          </div>
          <button
            aria-label="添加任务"
            title="添加任务（单次 / 打卡）"
            onClick={() => setAddOpen(true)}
            className="grid place-items-center w-12 h-12 rounded-full border border-ok/30 shadow-sm hover:scale-105 active:scale-95 transition-all shrink-0 mb-1 cursor-pointer"
            style={{ background: 'color-mix(in srgb, var(--ok) 14%, var(--surface))', color: 'var(--ok)' }}
          >
            <Plus size={24} strokeWidth={2.4} />
          </button>
        </div>
        <p className="text-[13px] text-on-surface-2 mt-1">
          {todayTasks.length > 0
            ? `今天有 ${todayTasks.length} 件事等你处理，一件件来。`
            : '今天的清单已清空，享受此刻。'}
        </p>
      </header>

      <SmartSuggestions all={all} />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
        {/* 今日任务 */}
        <section className="md:col-span-3 min-w-0">
          <div className="flex items-baseline gap-2 px-1 mb-2.5">
            <h2 className="text-[15px] font-semibold">今日任务</h2>
            {todayDone.length > 0 && (
              <span className="text-[12px] text-ok font-medium">已完成 {todayDone.length}</span>
            )}
          </div>
          <TaskList
            scope="today"
            tasks={todayTasks}
            emptyTitle="今天没有安排"
            emptyHint="点右上角加号添加任务；写「每天」可创建打卡任务。"
          />
        </section>

        {/* 侧栏卡片组 */}
        <aside className="md:col-span-2 flex flex-col gap-4 min-w-0">
          <section className="card p-4">
            <h2 className="text-[13px] font-semibold text-on-surface-2 mb-3">进度</h2>
            <div className="grid grid-cols-2 gap-3">
              <Kpi value={todayTasks.length} label="今日待办" />
              <Kpi value={todayDone.length} label="今日完成" tone="ok" />
              <Kpi value={weekDone} label="本周完成" />
              <Kpi value={totalDone} label="累计完成" />
            </div>
          </section>

          <div className="hidden md:block">
            <button
              type="button"
              onClick={() => openShortcuts(true)}
              className="card card-hover p-4 flex items-center gap-3 text-left cursor-pointer w-full"
            >
              <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-3 text-on-surface-2 shrink-0">
                <Keyboard size={17} />
              </span>
              <span>
                <span className="block text-[13px] font-medium">全键盘工作流</span>
                <span className="block text-[12px] text-on-surface-2 mt-0.5">按 ? 查看快捷键，N 快速添加</span>
              </span>
            </button>
          </div>

          <FocusTimer />
          <FocusTimer />
          <RecentReads />
        </aside>
      </div>

      <AddTaskSheet open={addOpen} onOpenChange={setAddOpen} defaultTier="today" todayContext />
    </div>
  )
}

/** My Day 智能建议队列：逾期 → 今日到期 → 3 日内 → 高优先加权 */
function SmartSuggestions({ all }: { all: import('@/db/db').Task[] }) {
  const suggestions = useMemo(() => {
    const today = todayStr()
    const threeDays = new Date()
    threeDays.setDate(threeDays.getDate() + 3)
    const threeDaysStr = `${threeDays.getFullYear()}-${String(threeDays.getMonth() + 1).padStart(2, '0')}-${String(threeDays.getDate()).padStart(2, '0')}`

    return all
      .filter((t) => t.status !== 'done' && t.tier !== 'today' && t.tier !== 'someday')
      .map((t) => {
        let score = 0
        if (t.due && t.due < today) score += 100 // 逾期最高
        else if (t.due && t.due === today) score += 80
        else if (t.due && t.due <= threeDaysStr) score += 50
        if (t.priority <= 1) score += 30 // P0/P1 加权
        return { task: t, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  }, [all])

  if (suggestions.length === 0) return null

  return (
    <section className="card p-4 border-ok/25">
      <div className="flex items-center gap-2 mb-2.5">
        <Sparkles size={14} className="text-ok" />
        <span className="text-[13px] font-semibold text-ok">今日建议</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {suggestions.map(({ task }) => (
          <button
            key={task.id}
            onClick={() => { window.location.hash = `#/tasks?tier=${task.tier}&focus=${task.id}` }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-3 transition-colors text-left cursor-pointer w-full"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: task.priority === 0 ? 'var(--p0)' : task.priority === 1 ? 'var(--p1)' : 'var(--p2)' }}
            />
            <span className="text-[13px] truncate flex-1">{task.title}</span>
            {task.due && task.due < todayStr() && <span className="text-[10.5px] text-danger shrink-0">逾期</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/** 最近阅读（M2）：点击直达上次阅读位置 */
function RecentReads() {
  const navigate = useNavigate()
  const recent = useRecentDocs(3)
  return (
    <button
      type="button"
      onClick={() => navigate('/docs')}
      className="card card-hover p-4 text-left cursor-pointer"
    >
      <span className="flex items-center gap-2.5 mb-2.5">
        <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-3 text-on-surface-2 shrink-0">
          <History size={17} />
        </span>
        <span>
          <span className="block text-[13px] font-medium">最近阅读</span>
          <span className="block text-[12px] text-on-surface-2 mt-0.5">继续上次的进度</span>
        </span>
      </span>
      {recent.length > 0 ? (
        <span className="flex flex-col gap-1.5">
          {recent.map((d) => (
            <span
              key={d.id}
              role="button"
              onClick={(e) => {
                e.stopPropagation()
                openDoc({ docId: d.id })
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[10px] hover:bg-surface-3 transition-colors"
            >
              <span className="text-[13px] truncate flex-1">{d.title}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="block text-[12px] text-on-surface-2">到「文档工作站」导入或撰写文档后，这里会显示最近打开的内容</span>
      )}
    </button>
  )
}

function Kpi({ value, label, tone }: { value: number; label: string; tone?: 'ok' }) {
  return (
    <div className="rounded-[12px] bg-surface px-3 py-2.5 border border-outline/60">
      <b className={`block text-[22px] leading-7 font-bold ${tone === 'ok' ? 'text-ok' : 'text-primary'}`}>{value}</b>
      <span className="text-[12px] text-on-surface-2">{label}</span>
    </div>
  )
}
