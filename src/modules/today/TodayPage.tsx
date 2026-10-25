import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ChevronRight, Clock3, History, Keyboard, Plus, X } from 'lucide-react'
import { useAllTasks, useRecentDocs, useDateTick, deriveToday, deriveTodayDone } from '@/db/hooks'
import { rolloverTasks, sortTasks } from '@/db/tasks'
import { addDaysStr, isThisWeek, fmtWeekdayLong, greeting, todayStr } from '@/lib/date'
import { TaskList } from '@/modules/tasks/TaskList'
import { useUi } from '@/stores/ui'
import { openDoc } from '@/shared/DeepLink'
import { FocusTimer } from '@/modules/focus/FocusTimer'
import { GettingStarted } from './GettingStarted'
import { prefersReducedMotion } from '@/lib/motion'
import { useMagnetic } from '@/lib/useMagnetic'
import { cn } from '@/lib/cn'

/** 今日 Dashboard：日期 + 加号添加 + 今日任务 + 进度 + 最近阅读 */
export function TodayPage() {
  const today = useDateTick()
  const all = useAllTasks()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const openAddSheet = useUi((s) => s.openAddSheet)
  const toast = useUi((s) => s.toast)
  const addRef = useRef<HTMLButtonElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  const jumpRaf = useRef(0)
  const [rolling, setRolling] = useState(false)
  useMagnetic(addRef)
  // 任务「开始专注」深链：/today?focus-task=<id> → 番茄钟自动绑定
  const focusTaskParam = params.get('focus-task') ?? undefined
  useEffect(() => {
    if (!focusTaskParam) return
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('focus-task')
      return next
    }, { replace: true })
  }, [focusTaskParam, setParams])
  // 安卓桌面快捷方式：workstation://quickadd → /today?quickadd=1，打开录入并抹掉参数
  const quickaddParam = params.get('quickadd')
  useEffect(() => {
    if (!quickaddParam) return
    openAddSheet({ tier: 'today', todayContext: true })
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('quickadd')
      return next
    }, { replace: true })
  }, [quickaddParam, setParams, openAddSheet])
  const todayTasks = useMemo(() => sortTasks(deriveToday(all, today)), [all, today])
  const todayDone = useMemo(() => deriveTodayDone(all, today), [all, today])
  // 「随时」清单也放进今日页：没有截止日、平时容易一直沉底的任务，在这里能顺手做掉
  const anytimeTasks = useMemo(
    () => sortTasks(all.filter((t) => t.status !== 'done' && t.tier === 'anytime' && !t.due)),
    [all],
  )
  const weekDone = useMemo(() => all.filter((t) => t.status === 'done' && isThisWeek(t.doneAt ?? 0)).length, [all])
  const totalDone = useMemo(() => all.filter((t) => t.status === 'done').length, [all])
  useEffect(() => {
    const open = () => openAddSheet({ tier: 'today', todayContext: true })
    window.addEventListener('ws:focus-quickadd', open)
    return () => window.removeEventListener('ws:focus-quickadd', open)
  }, [openAddSheet])

  const date = useMemo(() => new Date(), [today])

  useEffect(() => () => cancelAnimationFrame(jumpRaf.current), [])

  const roll = async () => {
    if (rolling || !todayTasks.length) return
    setRolling(true)
    try {
      await rolloverTasks(todayTasks)
      toast(`已把 ${todayTasks.length} 件挪到明天`)
    } catch {
      toast('挪动失败，请重试')
    } finally {
      setRolling(false)
    }
  }

  /**
   * 圆环 → 番茄钟。番茄钟已完整在视口里就不动；
   * 否则用缓出曲线滚过去，接近手指下滑的节奏，不瞬移。
   */
  const jumpToFocus = () => {
    const el = focusRef.current
    const scroller = document.getElementById('main-scroll')
    if (!el || !scroller) return
    const er = el.getBoundingClientRect()
    const sr = scroller.getBoundingClientRect()
    if (er.top >= sr.top && er.bottom <= sr.bottom) return
    const centered = scroller.scrollTop + (er.top - sr.top) - Math.max(12, (scroller.clientHeight - er.height) / 2)
    const target = Math.max(0, er.height < scroller.clientHeight ? centered : scroller.scrollTop + (er.top - sr.top) - 12)
    const start = scroller.scrollTop
    const delta = target - start
    cancelAnimationFrame(jumpRaf.current)
    if (prefersReducedMotion()) { scroller.scrollTop = target; return }
    const duration = Math.min(860, Math.max(460, Math.abs(delta) * 0.72))
    const t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      scroller.scrollTop = start + delta * ease(p)
      if (p < 1) jumpRaf.current = requestAnimationFrame(step)
    }
    jumpRaf.current = requestAnimationFrame(step)
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-2 pb-24 md:pb-14 flex flex-col gap-2.5 md:gap-4 cascade">
      <Milestone total={todayTasks.length} done={todayDone.length} />
      <header className="pt-0.5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] text-on-surface-2">{greeting(date)}</p>
            <h1 className="text-[24px] md:text-[32px] font-semibold leading-[30px] md:leading-[40px] tracking-tight mt-0.5">
              {fmtWeekdayLong(date)}
            </h1>
          </div>
          {/* 手机：一枚小进度环顶替原来那 4 张数字卡（完成 3/8 一眼可见，不占一屏） */}
          <ProgressRing done={todayDone.length} total={todayTasks.length + todayDone.length} onClick={jumpToFocus} className="md:hidden shrink-0 mb-0.5" />
          <button
            ref={addRef}
            aria-label="添加任务"
            title="添加任务（单次 / 打卡）"
            data-tour="add"
            onClick={() => openAddSheet({ tier: 'today', todayContext: true })}
            className={cn(
              'group hidden md:grid relative place-items-center w-12 h-12 rounded-full border border-primary/20 bg-primary-soft text-primary shadow-sm shrink-0 mb-1 cursor-pointer',
              'active:scale-[0.98] transition-transform',
              '[--magnet-glow:color-mix(in_srgb,var(--primary)_22%,transparent)]',
            )}
            style={{ background: 'color-mix(in srgb, var(--primary) 12%, var(--surface))', color: 'var(--primary)' }}
          >
            <span aria-hidden className="magnet-glow absolute inset-0 rounded-full" />
            <Plus size={24} strokeWidth={2.4} className="relative z-10" />
          </button>
        </div>
        {/* 手机空态时收起重复说明，把首屏让给专注控件 */}
        <p className={cn('text-[13px] text-on-surface-2 mt-1', todayTasks.length === 0 && 'hidden md:block')}>
          {todayTasks.length > 0
            ? `今天有 ${todayTasks.length} 件事等你处理，一件件来。`
            : '今天的清单已清空，享受此刻。'}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 md:gap-4 items-start">
        {/* 今日任务 */}
        <section className="md:col-span-3 min-w-0">
          <div className="flex items-baseline gap-2 px-1 mb-2">
            <h2 className="text-[15px] font-semibold">今日任务</h2>
            {todayDone.length > 0 && (
              <span className="text-[12px] text-ok font-medium">已完成 {todayDone.length}</span>
            )}
            {todayTasks.length > 0 && (
              <button
                type="button"
                disabled={rolling}
                onClick={() => void roll()}
                className="ml-auto text-[11.5px] text-on-surface-2 hover:text-on-surface disabled:opacity-50 cursor-pointer"
              >
                {rolling ? '挪动中…' : '挪到明天'}
              </button>
            )}
          </div>
          <TaskList
            scope="today"
            denseEmpty
            tasks={todayTasks}
            emptyTitle="今日暂无待办"
            emptyHint="点加号（桌面在右上角、手机在右下角），或按 N 快速添加；写「每天」可创建打卡任务。"
          />
          {/* 空态下面直接给下一步：没有任务、也没导入过文档的新用户最需要这个 */}
          {todayTasks.length === 0 && <GettingStarted />}
          <SmartSuggestions all={all} />

          {anytimeTasks.length > 0 && (
            <>
              <div className="mt-5 hidden md:block">
                <div className="flex items-baseline gap-2 px-1 mb-2">
                  <h2 className="text-[15px] font-semibold">随时</h2>
                  <span className="text-[12px] text-on-surface-2">{anytimeTasks.length}</span>
                </div>
                <TaskList
                  scope="anytime"
                  tasks={anytimeTasks}
                  emptyTitle="没有随时任务"
                  emptyHint="在任务清单里放进「随时」的任务会出现在这里。"
                />
              </div>
              <button
                type="button"
                onClick={() => navigate('/tasks?tier=anytime')}
                className="md:hidden mt-3 w-full card card-hover px-4 py-2.5 flex items-center gap-2 text-left cursor-pointer"
              >
                <span className="text-[13px] font-medium">随时清单</span>
                <span className="text-[12px] text-on-surface-2">{anytimeTasks.length} 件</span>
                <ChevronRight size={15} className="ml-auto text-on-surface-2" />
              </button>
            </>
          )}
        </section>

        {/* 侧栏卡片组：手机顺序按「此刻最想用的」排 —— 番茄钟 → 最近阅读，
            进度与键盘卡只在桌面出现（手机上进度环已经在标题旁） */}
        <aside className="md:col-span-2 flex flex-col gap-3 md:gap-4 min-w-0">
          <div ref={focusRef} id="focus-timer" className="order-1 md:order-none min-w-0 scroll-mt-4">
            <FocusTimer initialTaskId={focusTaskParam} />
          </div>

          <div className="order-2 md:order-none min-w-0 hidden md:block">
            <RecentReads />
          </div>

          <section className="hidden md:block card p-4 order-3 md:order-none">
            <h2 className="text-[13px] font-semibold text-on-surface-2 mb-3">进度</h2>
            <div className="grid grid-cols-2 gap-3">
              <Kpi value={todayTasks.length} label="今日待办" />
              <Kpi value={todayDone.length} label="今日完成" />
              <Kpi value={weekDone} label="本周完成" />
              <Kpi value={totalDone} label="累计完成" />
            </div>
          </section>

          <KeyboardHint className="hidden md:block order-4 md:order-none" />
        </aside>
      </div>

    </div>
  )
}

/**
 * 今日完成度小环：手机上一眼看到进度（不再写 3/8 的数字，环本身就是答案）。
 * 点击它平滑滑到番茄钟——任务多时不用一路划下去找。
 * 环的进度用 stroke-dashoffset 过渡，减少动效时由全局兜底压平。
 */
function ProgressRing({ done, total, onClick, className }: {
  done: number; total: number; onClick: () => void; className?: string
}) {
  // 今天一件都没有时不画环：0/0 的圆环看着像出错
  if (total === 0) return null
  const pct = done / total
  const R = 15
  const C = 2 * Math.PI * R
  const full = done >= total
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`今日完成 ${done} / ${total}，跳到番茄钟`}
      title="跳到番茄钟"
      className={cn(className, 'cursor-pointer active:scale-95 transition-transform')}
    >
      <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="3.2" />
        <circle
          cx="18" cy="18" r={R} fill="none"
          stroke={full ? 'var(--ok)' : 'var(--primary)'}
          strokeWidth="3.2" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          style={{ transition: 'stroke-dashoffset var(--dur-3) var(--ease-standard)' }}
        />
      </svg>
    </button>
  )
}

/**
 * 键盘快捷键提示卡：用过一次（点开过快捷键面板）就收起来，不常驻占位。
 * 「收起」写进 localStorage，下次进来自动隐藏；想找回来在设置里再打开。
 */
function KeyboardHint({ className }: { className?: string }) {
  const openShortcuts = useUi((s) => s.setShortcutsOpen)
  const [hidden, setHidden] = useState(() => localStorage.getItem('ws-kbd-hint-dismissed') === '1')
  if (hidden) return null
  const dismiss = () => {
    localStorage.setItem('ws-kbd-hint-dismissed', '1')
    setHidden(true)
  }
  return (
    <div className={className}>
      <div className="card p-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => { openShortcuts(true); dismiss() }}
          className="flex items-center gap-3 text-left cursor-pointer flex-1 min-w-0"
        >
          <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-3 text-on-surface-2 shrink-0">
            <Keyboard size={17} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">全键盘工作流</span>
            <span className="block text-[12px] text-on-surface-2 mt-0.5">按 ? 查看快捷键，N 快速添加</span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="收起快捷键提示"
          title="收起来"
          className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-on-surface-2/70 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

/** My Day 智能建议队列：逾期 → 今日到期 → 3 日内 → 高优先加权 */
function SmartSuggestions({ all }: { all: import('@/db/db').Task[] }) {
  const suggestions = useMemo(() => {
    const today = todayStr()
    const threeDaysStr = addDaysStr(3)

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
    <section className="card p-4 mt-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Clock3 size={14} className="text-on-surface-2" />
        <span className="text-[12px] font-medium text-on-surface-2 tracking-wide">今日建议</span>
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
      className="card card-hover w-full p-4 text-left cursor-pointer"
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

function Kpi({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[12px] bg-surface px-3 py-2.5 border border-outline/60">
      <b className="block text-[22px] leading-7 font-bold text-primary">{value}</b>
      <span className="text-[12px] text-on-surface-2">{label}</span>
    </div>
  )
}

/**
 * 里程碑撒花（P2）：仅当「今日待办全部完成」这一真实成就出现「未满→满」跃迁时触发一次，
 * 日常单任务完成不撒。粒子为纯装饰，减弱动效下不渲染。
 */
function Milestone({ total, done }: { total: number; done: number }) {
  const [bursting, setBursting] = useState(false)
  const prevAllDone = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const allDone = total > 0 && done === total
    if (allDone && !prevAllDone.current && !prefersReducedMotion()) {
      setBursting(true)
      timer.current = window.setTimeout(() => setBursting(false), 1000)
    }
    prevAllDone.current = allDone
    return () => window.clearTimeout(timer.current)
  }, [total, done])

  if (!bursting) return null
  const COLORS = ['var(--ok)', 'var(--primary)', 'var(--p1)', '#E9C46A']
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center" aria-hidden>
      <div className="relative w-0 h-0">
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (Math.PI * 2 * i) / 12
          const dist = 70 + (i % 3) * 26
          return (
            <span
              key={i}
              className="milestone-dot"
              style={{
                background: COLORS[i % COLORS.length],
                ['--dx' as string]: `${Math.cos(angle) * dist}px`,
                ['--dy' as string]: `${Math.sin(angle) * dist + 40}px`,
                ['--rot' as string]: `${(i % 2 ? 1 : -1) * (180 + i * 20)}deg`,
                animationDelay: `${i * 12}ms`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
