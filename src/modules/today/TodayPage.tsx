import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Bot, CheckCircle2, FileText, FileType2, History, Keyboard } from 'lucide-react'
import { useAllTasks, useRecentDocs, deriveToday, deriveTodayDone } from '@/db/hooks'
import { sortTasks } from '@/db/tasks'
import { useAi } from '@/stores/ai'
import { isThisWeek, fmtWeekdayLong, greeting } from '@/lib/date'
import { QuickAdd } from '@/modules/tasks/QuickAdd'
import { TaskList } from '@/modules/tasks/TaskList'
import { useUi } from '@/stores/ui'
import { openDoc } from '@/shared/DeepLink'

/** 今日 Dashboard（方案 2.4）：每日笔记式聚合首页 —— 今日任务 + 统计 + 模块状态 */
export function TodayPage() {
  const all = useAllTasks()
  const todayTasks = useMemo(() => sortTasks(deriveToday(all)), [all])
  const todayDone = useMemo(() => deriveTodayDone(all), [all])
  const weekDone = useMemo(() => all.filter((t) => t.status === 'done' && isThisWeek(t.doneAt ?? 0)).length, [all])
  const totalDone = useMemo(() => all.filter((t) => t.status === 'done').length, [all])
  const openShortcuts = useUi((s) => s.setShortcutsOpen)
  const navigate = useNavigate()
  const aiRunning = Object.keys(useAi((s) => s.running)).length

  const date = new Date()

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-5 enter">
      <header className="pt-1">
        <p className="text-[13px] text-on-surface-2">{greeting(date)}</p>
        <h1 className="text-[32px] md:text-[34px] font-bold leading-[40px] tracking-tight mt-0.5">
          {fmtWeekdayLong(date)}
        </h1>
        <p className="text-[13.5px] text-on-surface-2 mt-1">
          {todayTasks.length > 0
            ? `今天有 ${todayTasks.length} 件事等你处理，一件件来。`
            : '今天的清单已清空，享受此刻。'}
        </p>
      </header>

      <QuickAdd defaultTier="today" todayContext placeholder="今天要做什么？（下午3点 开会 P1）" />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
        {/* 今日任务 */}
        <section className="md:col-span-3 min-w-0">
          <div className="flex items-baseline gap-2 px-1 mb-2.5">
            <h2 className="text-[15px] font-semibold">今日任务</h2>
            {todayDone.length > 0 && (
              <span className="text-[11.5px] text-ok font-medium">已完成 {todayDone.length}</span>
            )}
          </div>
          <TaskList
            scope="today"
            tasks={todayTasks}
            emptyTitle="今天没有安排"
            emptyHint="添加时写「明天」「下周三」会自动进入「近期」清单。"
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

          <section className="card p-4">
            <h2 className="text-[13px] font-semibold text-on-surface-2 mb-3">模块</h2>
            <div className="flex flex-col gap-2.5 text-[13.5px]">
              <ModuleRow icon={CheckCircle2} name="任务清单" desc="M1 已上线" tone="ok" />
              <ModuleRow icon={FileText} name="文档工作站" desc="M2 已上线" tone="ok" />
              <button
                type="button"
                onClick={() => navigate('/ai')}
                className="flex items-center gap-2.5 text-left cursor-pointer"
              >
                <Bot size={16} className={aiRunning > 0 ? 'text-primary' : 'text-on-surface-2'} />
                <span className="font-medium">AI 助手</span>
                {aiRunning > 0 && (
                  <span className="flex items-center gap-1 text-[11.5px] text-primary">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ai-pulse" />
                    {aiRunning} 个生成中
                  </span>
                )}
                {!aiRunning && <span className="ml-auto text-[11.5px] text-on-surface-2">M3 已上线</span>}
              </button>
            </div>
          </section>

          <button
            type="button"
            onClick={() => openShortcuts(true)}
            className="card card-hover p-4 flex items-center gap-3 text-left cursor-pointer"
          >
            <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-3 text-on-surface-2 shrink-0">
              <Keyboard size={17} />
            </span>
            <span>
              <span className="block text-[13.5px] font-medium">全键盘工作流</span>
              <span className="block text-[12px] text-on-surface-2 mt-0.5">按 ? 查看快捷键，N 快速添加</span>
            </span>
          </button>

          <RecentReads />
        </aside>
      </div>
    </div>
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
          <span className="block text-[13.5px] font-medium">最近阅读</span>
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
              {d.kind === 'pdf' ? <FileText size={14} className="text-on-surface-2 shrink-0" /> : <FileType2 size={14} className="text-on-surface-2 shrink-0" />}
              <span className="text-[12.5px] truncate flex-1">{d.title}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="block text-[12px] text-on-surface-2">到「文档工作站」导入 PDF / Markdown 后，这里会显示最近打开的文档</span>
      )}
    </button>
  )
}

function Kpi({ value, label, tone }: { value: number; label: string; tone?: 'ok' }) {
  return (
    <div className="rounded-[12px] bg-surface px-3 py-2.5 border border-outline/60">
      <b className={`block text-[22px] leading-7 font-bold ${tone === 'ok' ? 'text-ok' : 'text-primary'}`}>{value}</b>
      <span className="text-[11.5px] text-on-surface-2">{label}</span>
    </div>
  )
}

function ModuleRow({
  icon: Icon,
  name,
  desc,
  tone,
}: {
  icon: typeof Bot
  name: string
  desc: string
  tone?: 'ok'
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={16} className={tone === 'ok' ? 'text-ok' : 'text-on-surface-2'} />
      <span className="font-medium">{name}</span>
      <span className="ml-auto text-[11.5px] text-on-surface-2">{desc}</span>
    </div>
  )
}
