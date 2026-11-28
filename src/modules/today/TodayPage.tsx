import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Check, ChevronRight, Clock3, Copy, FileText, History, Keyboard, Plus, TrendingUp, X } from 'lucide-react'
import { db, DOC_KIND_LABEL } from '@/db/db'
import { importDoc } from '@/db/docs'
import { useAllTasks, useRecentDocs, useDateTick, deriveToday, deriveTodayDone } from '@/db/hooks'
import { addTask, rolloverTasks, sortTasks } from '@/db/tasks'
import { addDaysStr, isThisWeek, fmtWeekdayLong, todayStr, toDateStr } from '@/lib/date'
import { TaskList } from '@/modules/tasks/TaskList'
import { QUOTA_KEY, type QuotaRecord } from '@/modules/stats/aiQuota'
import { useUi } from '@/stores/ui'
import { docPath } from '@/shared/DeepLink'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { FocusTimer } from '@/modules/focus/FocusTimer'
import { GettingStarted } from './GettingStarted'
import { buildDailyDigestMarkdown, findExpiringQuotas } from './dailyDigest'
import { prefersReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/cn'

/** 今日 Dashboard：日期 + 加号添加 + 今日任务 + 进度 + 最近阅读 */
export function TodayPage() {
  const today = useDateTick()
  const all = useAllTasks()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const openAddSheet = useUi((s) => s.openAddSheet)
  const toast = useUi((s) => s.toast)
  const focusRef = useRef<HTMLDivElement>(null)
  const [rolling, setRolling] = useState(false)
  const [digestOpen, setDigestOpen] = useState(false)
  const [quotaAlertDismissed, setQuotaAlertDismissed] = useState(false)
  const quotaRecords = useLiveQuery(
    async () => ((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? [],
    [],
    [] as QuotaRecord[],
  )
  const expiringQuotas = useMemo(() => findExpiringQuotas(quotaRecords, today, 3), [quotaRecords, today])

  const digestData = useLiveQuery(
    async () => {
      if (!digestOpen) return null
      const [sessions, annotations, docs] = await Promise.all([
        db.focusSessions.where('day').equals(today).toArray(),
        db.annotations.toArray(),
        db.docs.toArray(),
      ])
      const todayAnnotations = annotations.filter((a) => toDateStr(new Date(a.createdAt)) === today)
      return { sessions, todayAnnotations, docs }
    },
    [digestOpen, today],
    null,
  )
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

  const date = useMemo(() => {
    void today
    return new Date()
  }, [today])

  const greeting = useMemo(() => {
    const h = date.getHours()
    if (h < 6) return '夜深了'
    if (h < 11) return '早上好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  }, [date])

  const todayTotal = todayTasks.length + todayDone.length
  const todayPct = todayTotal > 0 ? Math.round((todayDone.length / todayTotal) * 100) : 0

  const roll = async () => {
    if (rolling || !todayTasks.length) return
    setRolling(true)
    try {
      const { count, undo } = await rolloverTasks(todayTasks)
      if (count > 0) {
        toast(`已把 ${count} 件挪到明天`, {
          label: '撤销',
          run: async () => {
            try {
              const restored = await undo()
              toast(restored > 0 ? `已恢复 ${restored} 件任务` : '任务已变更，无需恢复')
            } catch {
              toast('撤销失败，请检查任务清单')
            }
          },
        })
      }
    } catch {
      toast('挪动失败，请重试')
    } finally {
      setRolling(false)
    }
  }

  const digestMarkdown = useMemo(() => {
    if (!digestOpen || !digestData) return ''
    return buildDailyDigestMarkdown({
      day: today,
      doneTasks: todayDone,
      pendingTasks: todayTasks,
      focusSessions: digestData.sessions,
      annotations: digestData.todayAnnotations,
      docs: digestData.docs,
    })
  }, [digestOpen, digestData, today, todayDone, todayTasks])

  const createQuotaReminder = async (name: string, expiresAt: string) => {
    const title = `续费检查：${name}`
    if (all.some((t) => t.status !== 'done' && t.title === title)) {
      toast('已有同名的续费提醒任务')
      return
    }
    try {
      await addTask({
        title,
        tier: 'today',
        priority: 1,
        due: expiresAt >= today ? expiresAt : today,
        tags: ['额度续费'],
      })
      toast(`已加入今日任务：${title}`)
    } catch {
      toast('创建提醒任务失败')
    }
  }

  const saveDigestToDocs = async () => {
    if (!digestMarkdown) return
    try {
      const file = new File([digestMarkdown], `今日日报-${today}.md`, { type: 'text/markdown' })
      const { doc } = await importDoc(file)
      setDigestOpen(false)
      toast('今日日报已存入文档库', {
        label: '立即阅读',
        run: () => navigate(docPath({ docId: doc.id })),
      })
    } catch {
      toast('存入文档库失败，请重试')
    }
  }

  // 使用浏览器的滚动曲线，用户划动时可以直接接管。
  const jumpToFocus = () => {
    focusRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
    })
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-3.5 md:px-8 pt-3 md:pt-6 pb-24 md:pb-14 flex flex-col gap-3 md:gap-5">
      <Milestone total={todayTotal} done={todayDone.length} />
      <header>
        <div className="flex items-center md:items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-0.5 md:mb-1">
              <span className="text-[12px] md:text-[12.5px] font-medium text-on-surface-2">{greeting}</span>
              {/* 手机端由右侧进度环显示完成度。 */}
              {todayTotal > 0 && (
                <span className={cn(
                  'hidden md:inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
                  todayTasks.length === 0
                    ? 'bg-ok/12 text-ok'
                    : 'bg-primary-soft text-primary',
                )}>
                  {todayTasks.length === 0 ? (
                    <>
                      <Check size={11} aria-hidden /> 今日待办已清空
                    </>
                  ) : (
                    <>今日完成 {todayDone.length}/{todayTotal} · {todayPct}%</>
                  )}
                </span>
              )}
            </div>
            <h1 className="text-[24px] md:text-[34px] font-bold leading-tight tracking-[-0.03em]">
              {fmtWeekdayLong(date)}
            </h1>
          </div>
          {/* 点击进度环可跳到番茄钟。 */}
          <ProgressRing done={todayDone.length} total={todayTotal} onClick={jumpToFocus} className="md:hidden shrink-0" />
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setDigestOpen(true)}>
              <FileText size={14} /> 今日日报
            </Button>
            <button
              type="button"
              aria-label="添加任务"
              title="添加任务（单次 / 打卡）"
              onClick={() => openAddSheet({ tier: 'today', todayContext: true })}
              className="press btn-primary-glow grid place-items-center size-11 rounded-full bg-primary-action text-on-primary-action shrink-0 cursor-pointer transition-transform duration-150 hover:scale-105"
            >
              <Plus size={22} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </header>

      {expiringQuotas.length > 0 && !quotaAlertDismissed && (
        <div className="card px-3.5 py-2.5 border-p1/45 bg-p1/8 flex flex-wrap items-center gap-2.5 text-[12.5px]">
          <AlertTriangle size={15} className="text-p1 shrink-0" />
          <span className="flex-1 min-w-[180px] text-on-surface">
            模型额度提醒：<b>{expiringQuotas[0].entry.name}</b>（{expiringQuotas[0].label}）
            {expiringQuotas.length > 1 ? ` 等 ${expiringQuotas.length} 项即将到期` : ''}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void createQuotaReminder(expiringQuotas[0].entry.name, expiringQuotas[0].entry.expiresAt)}
            >
              转提醒任务
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/stats?tab=quota')}>
              查看额度
            </Button>
            <button
              type="button"
              aria-label="忽略本次提醒"
              onClick={() => setQuotaAlertDismissed(true)}
              className="grid place-items-center size-7 rounded-lg text-on-surface-2 hover:bg-surface-3 cursor-pointer"
            >
              <X size={13.5} />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4 items-start">
        {/* 今日任务 */}
        <section className="md:col-span-3 min-w-0">
          <div className="flex items-center gap-2 min-h-8 px-1 mb-1.5 md:mb-2">
            <h2 className="text-[15px] md:text-[16px] font-semibold">今日任务</h2>
            {todayDone.length > 0 && (
              <span className="text-[12px] text-ok font-medium tabular-nums">已完成 {todayDone.length}</span>
            )}
            <button
              type="button"
              onClick={() => setDigestOpen(true)}
              className="md:hidden ml-auto h-8 rounded-lg px-2 text-[12px] font-medium text-primary hover:bg-primary-soft transition-colors cursor-pointer"
            >
              今日日报
            </button>
            {todayTasks.length > 0 && (
              <button
                type="button"
                disabled={rolling}
                onClick={() => void roll()}
                className="md:ml-auto h-8 rounded-lg px-2.5 text-[12px] font-medium text-on-surface-2 hover:bg-surface-3/80 hover:text-on-surface transition-colors disabled:opacity-50 cursor-pointer"
              >
                {rolling ? '挪动中…' : '挪到明天'}
              </button>
            )}
          </div>
          <TaskList
            scope="today"
            denseEmpty
            hideEmptyAction
            tasks={todayTasks}
            emptyTitle="今日暂无待办"
            emptyHint="今天的待办会显示在这里。"
          />
          {/* 空态下面直接给下一步：没有任务、也没导入过文档的新用户最需要这个 */}
          {todayTasks.length === 0 && <GettingStarted />}
          <SuggestedTasks all={all} />

          {anytimeTasks.length > 0 && (
            <>
              <div className="mt-5 hidden md:block">
                <div className="flex items-baseline gap-2 px-1 mb-2">
                  <h2 className="text-[15px] font-semibold">随时</h2>
                  <span className="text-[12px] text-on-surface-2">{anytimeTasks.length}</span>
                </div>
                <TaskList
                  scope="anytime"
                  tier="anytime"
                  tasks={anytimeTasks}
                  emptyTitle="没有随时任务"
                  emptyHint="在任务清单里放进「随时」的任务会出现在这里。"
                />
              </div>
              <button
                type="button"
                onClick={() => navigate('/tasks?tier=anytime')}
                className="md:hidden mt-2.5 w-full card card-hover px-3.5 py-2.5 flex items-center gap-2 text-left cursor-pointer"
              >
                <span className="text-[13px] font-medium">随时清单</span>
                <span className="rounded-full bg-surface-3/85 px-2 py-0.5 text-[11px] font-medium text-on-surface-2 tabular-nums">{anytimeTasks.length} 件</span>
                <ChevronRight size={15} className="ml-auto text-on-surface-2" />
              </button>
            </>
          )}
        </section>

        {/* 窄屏仅显示番茄钟，完成度显示在页头。 */}
        <aside className="md:col-span-2 flex flex-col gap-3 md:gap-4 min-w-0">
          <div ref={focusRef} id="focus-timer" className="order-1 md:order-none min-w-0 scroll-mt-4">
            <FocusTimer initialTaskId={focusTaskParam} />
          </div>

          <div className="order-2 md:order-none min-w-0 hidden md:block">
            <RecentReads />
          </div>

          <section className="hidden md:block card p-4 order-3 md:order-none">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="grid size-9 place-items-center rounded-[12px] bg-primary-soft text-primary shrink-0">
                <TrendingUp size={17} aria-hidden />
              </span>
              <h2 className="text-[13.5px] font-semibold">任务概览</h2>
              {todayTotal > 0 && (
                <span className="ml-auto rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                  {todayPct}%
                </span>
              )}
            </div>
            {todayTotal > 0 && (
              <div className="h-1.5 rounded-full bg-surface-3/90 overflow-hidden mb-3.5" aria-hidden>
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500 ease-standard',
                    todayPct >= 100 ? 'bg-ok' : 'bg-primary',
                  )}
                  style={{ width: `${Math.max(todayPct, todayDone.length > 0 ? 6 : 0)}%` }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <Kpi value={todayTasks.length} label="今日待办" />
              <Kpi value={todayDone.length} label="今日完成" accent={todayDone.length > 0 ? 'var(--ok)' : undefined} />
              <Kpi value={weekDone} label="本周完成" />
              <Kpi value={totalDone} label="累计完成" />
            </div>
          </section>

          <KeyboardHint className="hidden md:block order-4 md:order-none" />
        </aside>
      </div>

      <Dialog
        open={digestOpen}
        onOpenChange={setDigestOpen}
        title={`今日日报 · ${today}`}
        description="汇总今日完成任务、专注时长、阅读批注与待续事项"
        widthClass="w-[min(640px,92vw)]"
      >
        <div className="flex flex-col gap-3">
          <pre className="rounded-[12px] border border-outline bg-surface-2 p-3.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-[52dvh] overflow-y-auto select-all">
            {digestMarkdown || '正在汇总今日数据…'}
          </pre>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDigestOpen(false)}>关闭</Button>
            <Button
              variant="outline"
              disabled={!digestMarkdown}
              onClick={() => {
                void navigator.clipboard.writeText(digestMarkdown)
                  .then(() => toast('已复制今日日报 Markdown'))
                  .catch(() => toast('复制失败，请重试'))
              }}
            >
              <Copy size={14} /> 复制 Markdown
            </Button>
            <Button variant="primary" disabled={!digestMarkdown} onClick={() => void saveDigestToDocs()}>
              <FileText size={14} /> 存入文档库
            </Button>
          </div>
        </div>
      </Dialog>

    </div>
  )
}

/** 进度环同时是跳到番茄钟的入口。 */
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
      className={cn(
        className,
        'press relative grid place-items-center w-10 h-10 rounded-full cursor-pointer',
      )}
    >
      <svg viewBox="0 0 40 40" className="w-9 h-9 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--outline-strong)" strokeWidth="3.2" opacity="0.45" />
        <circle
          cx="20" cy="20" r={R} fill="none"
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

/** 打开过快捷键面板或手动收起后，在本机隐藏提示卡。 */
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
          className="flex min-h-11 items-center gap-3 text-left cursor-pointer flex-1 min-w-0"
        >
          <span className="grid place-items-center w-9 h-9 rounded-[12px] bg-primary-soft/80 text-primary shrink-0">
            <Keyboard size={17} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">键盘快捷键</span>
            <span className="block text-[12px] text-on-surface-2 mt-0.5">按 ? 查看快捷键，N 快速添加</span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="收起快捷键提示"
          title="收起来"
          className="shrink-0 size-11 grid place-items-center rounded-lg text-on-surface-2/70 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

/** 按到期日和优先级选取最多三项任务。 */
function SuggestedTasks({ all }: { all: import('@/db/db').Task[] }) {
  const navigate = useNavigate()
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
    <section className="card p-3 md:p-4 mt-2.5 md:mt-3">
      <div className="flex items-center gap-1.5 mb-1.5 md:mb-2.5">
        <Clock3 size={13.5} className="text-on-surface-2" />
        <span className="text-[12px] font-medium text-on-surface-2 tracking-wide">可能要做</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {suggestions.map(({ task }) => (
          <button
            key={task.id}
            onClick={() => navigate(`/tasks?tier=${task.tier}&focus=${task.id}`)}
            className="flex min-h-11 items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-3 transition-colors text-left cursor-pointer w-full"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: task.priority === 0 ? 'var(--p0)' : task.priority === 1 ? 'var(--p1)' : 'var(--p2)' }}
            />
            <span className="text-[13px] truncate flex-1">{task.title}</span>
            {task.due && task.due < todayStr() && <span className="text-[11px] text-danger shrink-0">逾期</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

function RecentReads() {
  const recent = useRecentDocs(3)
  return (
    <section aria-label="最近阅读" className="card w-full p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <span className="grid size-9 place-items-center rounded-[12px] bg-primary-soft text-primary shrink-0">
          <History size={17} aria-hidden />
        </span>
        <h2 className="text-[13.5px] font-semibold">最近阅读</h2>
        <Link to="/docs" className="ml-auto inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium text-primary hover:bg-primary-soft transition-colors">
          文档库
        </Link>
      </div>
      {recent.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {recent.map((doc) => (
            <li key={doc.id}>
              <Link
                to={docPath({ docId: doc.id })}
                className="group flex min-h-10 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px] hover:bg-surface-2 transition-colors"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-on-surface">{doc.title}</span>
                <span className="rounded-md bg-surface-3/85 px-1.5 py-0.5 text-[10.5px] font-medium text-on-surface-2 shrink-0">
                  {DOC_KIND_LABEL[doc.kind]}
                </span>
                <ChevronRight size={14} aria-hidden className="text-on-surface-2 transition-transform group-hover:translate-x-0.5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[12px] leading-relaxed text-on-surface-2">在文档库导入或撰写文档后，这里会显示最近打开的内容。</p>
      )}
    </section>
  )
}

function Kpi({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <div className="rounded-[14px] bg-surface-2/85 px-3.5 py-3 border border-outline/80 transition-colors hover:border-primary/30 hover:bg-surface">
      <b
        className="block text-[24px] leading-7 font-bold tracking-[-0.02em] tabular-nums text-primary"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </b>
      <span className="text-[12px] text-on-surface-2 mt-0.5 block">{label}</span>
    </div>
  )
}

/** 从未完成变为全部完成时播放一次。 */
function Milestone({ total, done }: { total: number; done: number }) {
  const [bursting, setBursting] = useState(false)
  const prevAllDone = useRef<boolean | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const allDone = total > 0 && done === total
    if (allDone && prevAllDone.current === false && !prefersReducedMotion()) {
      setBursting(true)
      timer.current = window.setTimeout(() => setBursting(false), 1000)
    }
    prevAllDone.current = total > 0 ? allDone : null
    return () => window.clearTimeout(timer.current)
  }, [total, done])

  if (!bursting) return null
  const COLORS = ['var(--ok)', 'var(--primary)', 'var(--p1)', 'var(--p2)']
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
