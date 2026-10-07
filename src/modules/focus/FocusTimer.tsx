import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Coffee, Pause, Play, RotateCcw, Target, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'
import { db } from '@/db/db'
import type { Task } from '@/db/db'
import { addFocusSession } from '@/db/focus'
import { useAllTasks } from '@/db/hooks'
import { sortTasks } from '@/db/tasks'

type Phase = 'work' | 'break'

const DURATIONS: Record<Phase, number> = { work: 25 * 60, break: 5 * 60 }
const TASK_KEY = 'ws-focus-task'

/** 番茄钟 + 专注会话落库（v1.3：可绑定任务，统计页汇总） */
export function FocusTimer() {
  const [phase, setPhase] = useState<Phase>('work')
  const [remaining, setRemaining] = useState(DURATIONS.work)
  const [running, setRunning] = useState(false)
  const [taskId, setTaskId] = useState(() => localStorage.getItem(TASK_KEY) ?? '')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const todayStats = useLiveQuery(
    async () => {
      const rows = await db.focusSessions.where('day').equals(today).toArray()
      return { sessions: rows.length, minutes: rows.reduce((s, r) => s + r.minutes, 0) }
    },
    [today],
    { sessions: 0, minutes: 0 },
  )

  const all = useAllTasks()
  const candidates: Task[] = sortTasks(all.filter((t) => t.status !== 'done')).slice(0, 50)

  const completePhase = useCallback(() => {
    if (phase === 'work') {
      void addFocusSession(25, taskId || undefined)
      setPhase('break')
      setRemaining(DURATIONS.break)
    } else {
      setPhase('work')
      setRemaining(DURATIONS.work)
    }
    setRunning(false)
  }, [phase, taskId])

  useEffect(() => {
    if (!running) return
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(intervalRef.current!)
          completePhase()
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, completePhase])

  const pickTask = (id: string) => {
    setTaskId(id)
    if (id) localStorage.setItem(TASK_KEY, id)
    else localStorage.removeItem(TASK_KEY)
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const progress = 1 - remaining / DURATIONS[phase]
  const boundTask = all.find((t) => t.id === taskId)

  return (
    <div className="card p-5 flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <Timer size={16} className="text-on-surface-2" />
        <span className="text-[13px] font-semibold text-on-surface-2">
          {phase === 'work' ? '专注中' : '休息中'}
        </span>
      </div>

      {/* 圆形进度 + 时间 */}
      <div className="relative w-[140px] h-[140px]">
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
          <circle cx="70" cy="70" r="60" fill="none" stroke="var(--surface-3)" strokeWidth="8" />
          <circle
            cx="70" cy="70" r="60" fill="none"
            stroke={phase === 'work' ? 'var(--ok)' : 'var(--primary)'}
            strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${progress * 2 * Math.PI * 60} ${2 * Math.PI * 60}`}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn('text-[28px] font-bold tabular-nums', phase === 'work' ? 'text-ok' : 'text-primary')}>
            {mm}:{ss}
          </span>
        </div>
      </div>

      {/* 控制 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setRunning((r) => !r)}
          className={cn(
            'grid place-items-center w-12 h-12 rounded-full cursor-pointer transition-all',
            running ? 'bg-surface-3 text-on-surface' : 'bg-ok text-white shadow-sm hover:brightness-110',
          )}
          aria-label={running ? '暂停' : '开始'}
        >
          {running ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
        <button
          onClick={() => { setRunning(false); setPhase('work'); setRemaining(DURATIONS.work) }}
          className="grid place-items-center w-10 h-10 rounded-full bg-surface-3 text-on-surface-2 hover:text-on-surface cursor-pointer"
          aria-label="重置"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* 绑定任务：完成一个番茄即计入该任务耗时 */}
      <div className="w-full flex items-center gap-2">
        <Target size={14} className="text-on-surface-2 shrink-0" />
        <select
          value={taskId}
          onChange={(e) => pickTask(e.target.value)}
          aria-label="专注绑定任务"
          className="flex-1 h-8 px-2 rounded-[8px] bg-surface-2 border border-outline text-[12px] outline-none focus:border-primary/60 cursor-pointer min-w-0"
        >
          <option value="">不绑定任务</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>{t.title.slice(0, 24)}</option>
          ))}
        </select>
      </div>
      {boundTask && (
        <p className="text-[11px] text-on-surface-2 -mt-2 text-center truncate w-full">
          本次完成将计入「{boundTask.title.slice(0, 18)}」
        </p>
      )}

      {/* 今日专注统计 */}
      <div className="flex items-center gap-2 text-[12px] text-on-surface-2 w-full justify-center">
        <Coffee size={14} />
        <span>今日 {todayStats.sessions} 个番茄 · {todayStats.minutes} 分钟</span>
      </div>
    </div>
  )
}
