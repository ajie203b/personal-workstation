import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Coffee, RotateCcw, Target, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'
import { db } from '@/db/db'
import type { Task } from '@/db/db'
import { addFocusSession } from '@/db/focus'
import { cancelFocusEnd, scheduleFocusEnd } from '@/lib/notify'
import { useAllTasks } from '@/db/hooks'
import { sortTasks } from '@/db/tasks'
import { todayStr } from '@/lib/date'
import { haptic } from '@/lib/haptics'
import { useUi } from '@/stores/ui'
import { Segmented } from '@/shared/ui/Segmented'
import { PlayPauseIcon } from '@/shared/ui/PlayPauseIcon'
import { Dialog } from '@/shared/ui/Sheet'

type Phase = 'work' | 'break'

const WORK_PRESETS = ['15', '25', '45', '60']
const BREAK_MIN = 5
const STORE_KEY = 'ws-focus-timer'
const TASK_KEY = 'ws-focus-task'
/** 任务详情「开始专注」写入的一次性指令：进入今日页后弹出选时小框 */
const START_KEY = 'ws-focus-start'

interface TimerStore {
  phase: Phase
  running: boolean
  /**
   * 运行中 = 本轮结束的绝对时间戳，剩余秒数一律由 Date.now() 推算，
   * 所以刷新、关标签页、后台被节流都不漂移；暂停/待机时不用它。
   */
  endsAt: number
  /** 暂停/待机 = 本轮剩余秒数 */
  left: number
  workMin: number
}

const phaseSeconds = (phase: Phase, workMin: number) => (phase === 'work' ? workMin : BREAK_MIN) * 60
const storeSeconds = (s: TimerStore) => phaseSeconds(s.phase, s.workMin)

const idleStore = (): TimerStore => ({ phase: 'work', running: false, endsAt: 0, left: 25 * 60, workMin: 25 })

/** 读回上次没跑完的番茄；字段缺失或值不合法一律回默认，不让计时器进入半吊子状态 */
function loadStore(): TimerStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return idleStore()
    const s = JSON.parse(raw) as Partial<TimerStore>
    if (s.phase !== 'work' && s.phase !== 'break') return idleStore()
    const workMin = Number(s.workMin) > 0 ? Number(s.workMin) : 25
    const endsAt = Number(s.endsAt)
    const running = !!s.running && endsAt > 0
    const left = Number(s.left)
    return {
      phase: s.phase,
      workMin,
      running,
      endsAt: Number.isFinite(endsAt) ? endsAt : 0,
      left: Number.isFinite(left) ? Math.max(0, Math.min(left, phaseSeconds(s.phase, workMin))) : phaseSeconds(s.phase, workMin),
    }
  } catch {
    return idleStore()
  }
}

function remainingOf(s: TimerStore, now: number): number {
  const total = storeSeconds(s)
  if (!s.running) return Math.min(s.left, total)
  return Math.max(0, Math.min(total, Math.ceil((s.endsAt - now) / 1000)))
}

/** 番茄钟：按墙上时钟计时（跨刷新/后台继续跑）+ 可选专注时长 + 会话落库（可绑定任务） */
export function FocusTimer({ initialTaskId }: { initialTaskId?: string }) {
  const [store, setStore] = useState<TimerStore>(loadStore)
  const [now, setNow] = useState(() => Date.now())
  const toast = useUi((s) => s.toast)
  // StrictMode 会把 effect 吊两次，落库靠这个 ref 兜住，只记一次
  const settledRef = useRef(0)

  const remaining = remainingOf(store, now)

  // 必须用本地日期：toISOString() 是 UTC，北京时间 0–8 点会取到昨天，
  // 和落库用的 todayStr() 对不上，凌晨的专注会记到「今日」之外
  const today = todayStr()
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
  const [taskId, pickTask] = useFocusTaskId(initialTaskId)
  // 从任务详情点「开始专注」进来时，待选时的小框（值为任务 id）
  const [askTaskId, setAskTaskId] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  }, [store])

  // 消费任务详情写入的一次性「开始专注」指令：绑定任务（useFocusTaskId 负责）并弹出选时小框。
  // 依赖 initialTaskId 而非空数组：已在今日页时 hash 变化不会重挂本组件，参数变化才是可靠时机。
  useEffect(() => {
    if (!initialTaskId) return
    try {
      const raw = localStorage.getItem(START_KEY)
      if (!raw) return
      localStorage.removeItem(START_KEY)
      const p = JSON.parse(raw) as { taskId?: string; at?: number }
      if (p.taskId !== initialTaskId) return
      if (!p.at || Date.now() - p.at > 60_000) return // 陈旧指令忽略
      setAskTaskId(initialTaskId)
    } catch { /* 忽略坏数据 */ }
  }, [initialTaskId])

  // 250ms 对齐一次时钟：即使后台把 interval 节流到 1 分钟，回到前台也会立刻补算
  useEffect(() => {
    if (!store.running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    const onVis = () => setNow(Date.now())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [store.running])

  // 到期（含离开期间就已到期）：落库 → 进入下一阶段停住等用户，不自动续跑
  useEffect(() => {
    if (!store.running || remaining > 0 || settledRef.current === store.endsAt) return
    settledRef.current = store.endsAt
    const finishedWork = store.phase === 'work'
    if (finishedWork) void addFocusSession(store.workMin, taskId || undefined)
    toast(finishedWork ? `专注 ${store.workMin} 分钟完成，休息 ${BREAK_MIN} 分钟` : '休息结束，可以开始下一个番茄')
    haptic('success')
    setStore((s) => {
      const phase: Phase = s.phase === 'work' ? 'break' : 'work'
      return { ...s, phase, running: false, endsAt: 0, left: phaseSeconds(phase, s.workMin) }
    })
  }, [store.running, store.phase, store.endsAt, store.workMin, remaining, taskId, toast])

  const toggle = useCallback(() => {
    setStore((s) => {
      if (s.running) return { ...s, running: false, left: remainingOf(s, Date.now()), endsAt: 0 }
      const sec = remainingOf(s, Date.now()) || storeSeconds(s)
      return { ...s, running: true, endsAt: Date.now() + sec * 1000, left: sec }
    })
  }, [])

  const reset = useCallback(() => {
    setStore((s) => ({ phase: 'work', running: false, endsAt: 0, left: s.workMin * 60, workMin: s.workMin }))
  }, [])

  const pickMinutes = useCallback((min: number) => {
    setStore((s) => ({ ...s, workMin: min, left: s.phase === 'work' ? min * 60 : s.left }))
  }, [])

  /** 选时小框确认：设定时长并立即开跑（覆盖当前未跑的计时状态） */
  const startWithMinutes = useCallback((min: number) => {
    haptic('medium')
    setAskTaskId(null)
    setStore({ phase: 'work', running: true, endsAt: Date.now() + min * 60_000, left: min * 60, workMin: min })
  }, [])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const total = storeSeconds(store)
  const progress = total > 0 ? 1 - remaining / total : 0
  const boundTask = all.find((t) => t.id === taskId)
  const askTask = askTaskId ? all.find((t) => t.id === askTaskId) : undefined

  // 专注结束提醒：按 endsAt 排一条本地通知（锁屏/后台也能收到）；暂停、重置、结束时撤销
  useEffect(() => {
    if (!store.running || store.phase !== 'work') {
      void cancelFocusEnd()
      return
    }
    const body = boundTask ? `「${boundTask.title}」完成一轮专注` : `专注 ${store.workMin} 分钟结束`
    void scheduleFocusEnd(store.endsAt, body)
  }, [store.running, store.phase, store.endsAt, store.workMin, boundTask])

  return (
    <div className="card p-5 flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <Timer size={16} className="text-on-surface-2" />
        <span className="text-[13px] font-semibold text-on-surface-2">
          {store.phase === 'work' ? '专注中' : '休息中'}
        </span>
      </div>

      {/* 圆形进度 + 时间 */}
      <div className="relative w-[140px] h-[140px]">
        {/* 呼吸光晕：仅运行中显示，暂停即停（同屏只保留一个循环动画） */}
        {store.running && (
          <span
            aria-hidden
            className="focus-breathe absolute inset-1 rounded-full"
            style={{
              background:
                store.phase === 'work'
                  ? 'radial-gradient(circle, color-mix(in srgb, var(--ok) 24%, transparent) 0%, transparent 68%)'
                  : 'radial-gradient(circle, color-mix(in srgb, var(--primary) 24%, transparent) 0%, transparent 68%)',
            }}
          />
        )}
        <svg viewBox="0 0 140 140" className="relative w-full h-full -rotate-90">
          {/* 渐变描边：运行中更「活」，休息态换暖蓝 */}
          <defs>
            <linearGradient id="focus-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={store.phase === 'work' ? 'var(--ok)' : 'var(--primary)'} />
              <stop offset="1" stopColor={store.phase === 'work' ? '#1F9E6B' : '#6E97DB'} />
            </linearGradient>
          </defs>
          <circle cx="70" cy="70" r="60" fill="none" stroke="var(--surface-3)" strokeWidth="8" />
          <circle
            cx="70" cy="70" r="60" fill="none"
            stroke="url(#focus-grad)"
            strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${progress * 2 * Math.PI * 60} ${2 * Math.PI * 60}`}
            style={{ transition: 'stroke-dasharray 1s linear' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn('text-[28px] font-bold tabular-nums', store.phase === 'work' ? 'text-ok' : 'text-primary')}>
            {mm}:{ss}
          </span>
        </div>
      </div>

      {/* 专注时长：计时中不可改，改了会打断正在跑的这一个番茄 */}
      <div
        className={cn('w-full flex justify-center', store.running && 'opacity-50 pointer-events-none')}
        aria-disabled={store.running || undefined}
      >
        <Segmented
          ariaLabel="专注时长"
          size="sm"
          options={WORK_PRESETS.map((m) => ({ value: m, label: `${m}分` }))}
          value={String(store.workMin)}
          onChange={(v) => pickMinutes(Number(v))}
        />
      </div>

      {/* 控制 */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className={cn(
            'grid place-items-center w-12 h-12 rounded-full cursor-pointer transition-all',
            store.running ? 'bg-surface-3 text-on-surface' : 'bg-ok text-white shadow-sm hover:brightness-110',
          )}
          aria-label={store.running ? '暂停' : '开始'}
        >
          {<PlayPauseIcon playing={store.running} size={20} />}
        </button>
        <button
          onClick={reset}
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

      {/* 「开始专注」选时小框：选好立即开跑；关掉小框则只保留任务绑定 */}
      <Dialog
        open={askTaskId != null}
        onOpenChange={(v) => { if (!v) setAskTaskId(null) }}
        title="选择专注时长"
        description={askTask ? `「${askTask.title.slice(0, 20)}」选好立即开始` : '选好立即开始'}
      >
        <div className="grid grid-cols-2 gap-2.5 mt-1">
          {WORK_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => startWithMinutes(Number(m))}
              className="h-12 rounded-[12px] bg-surface-2 border border-outline text-[15px] font-semibold hover:border-ok/60 hover:bg-ok/10 hover:text-ok active:scale-95 transition-all cursor-pointer"
            >
              {m} 分钟
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  )
}

/** 绑定任务：初值来自深链或本机记忆，切换即写回本机 */
function useFocusTaskId(initialTaskId?: string): [string, (id: string) => void] {
  const [id, setId] = useState(() => initialTaskId ?? localStorage.getItem(TASK_KEY) ?? '')
  useEffect(() => {
    if (initialTaskId) setId(initialTaskId)
  }, [initialTaskId])
  const pick = useCallback((next: string) => {
    setId(next)
    if (next) localStorage.setItem(TASK_KEY, next)
    else localStorage.removeItem(TASK_KEY)
  }, [])
  return [id, pick]
}
