import { useCallback, useEffect, useRef, useState } from 'react'
import { Coffee, Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'

type Phase = 'work' | 'break'

const DURATIONS: Record<Phase, number> = { work: 25 * 60, break: 5 * 60 }

interface FocusRecord {
  date: string
  sessions: number
  minutes: number
}

const STORE_KEY = 'ws-focus-records'

function loadRecords(): Record<string, FocusRecord> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') } catch { return {} }
}

function saveRecord(date: string, minutes: number) {
  const all = loadRecords()
  const cur = all[date] ?? { date, sessions: 0, minutes: 0 }
  all[date] = { date, sessions: cur.sessions + 1, minutes: cur.minutes + minutes }
  localStorage.setItem(STORE_KEY, JSON.stringify(all))
}

function getTodayStats(): FocusRecord {
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return loadRecords()[key] ?? { date: key, sessions: 0, minutes: 0 }
}

/** 番茄钟 + 每日专注统计（v1.2） */
export function FocusTimer() {
  const [phase, setPhase] = useState<Phase>('work')
  const [remaining, setRemaining] = useState(DURATIONS.work)
  const [running, setRunning] = useState(false)
  const [todayStats, setTodayStats] = useState(getTodayStats)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const completePhase = useCallback(() => {
    if (phase === 'work') {
      saveRecord(new Date().toISOString().slice(0, 10), 25)
      setTodayStats(getTodayStats())
      setPhase('break')
      setRemaining(DURATIONS.break)
    } else {
      setPhase('work')
      setRemaining(DURATIONS.work)
    }
    setRunning(false)
  }, [phase])

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

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const progress = 1 - remaining / DURATIONS[phase]

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

      {/* 今日专注统计 */}
      <div className="flex items-center gap-2 text-[12px] text-on-surface-2 w-full justify-center">
        <Coffee size={14} />
        <span>今日 {todayStats.sessions} 个番茄 · {todayStats.minutes} 分钟</span>
      </div>
    </div>
  )
}
