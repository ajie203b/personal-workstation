import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Coffee, RotateCcw, Target, Timer, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { db } from '@/db/db'
import type { Task } from '@/db/db'
import { cancelFocusEnd, scheduleFocusEnd } from '@/lib/notify'
import { useAllTasks, useDateTick } from '@/db/hooks'
import { sortTasks } from '@/db/tasks'
import { haptic } from '@/lib/haptics'
import { isNative } from '@/lib/native'
import { Segmented } from '@/shared/ui/Segmented'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { PlayPauseIcon } from '@/shared/ui/PlayPauseIcon'
import { Dialog } from '@/shared/ui/Sheet'
import {
  FOCUS_SYNC_EVENT,
  isFocusSoundEnabled,
  setFocusSoundEnabled,
  settleExpiredFocusTimer,
} from '@/shared/FocusMiniBar'

type Phase = 'work' | 'break'

const WORK_PRESETS = ['15', '25', '45', '60']
const WORK_SEG_OPTIONS = WORK_PRESETS.map((m) => ({ value: m, label: `${m}分` }))
const RING_CIRCUMFERENCE = 2 * Math.PI * 60
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

/**
 * 圆形进度与倒计时数字独立子组件：
 * 250ms 对齐时钟只在整秒变化时更新自身 state，不再触发 FocusTimer 顶层的任务过滤与排序重算。
 */
function CountdownDisplay({
  store,
  onExpire,
}: {
  store: TimerStore
  onExpire: (endsAt: number) => void
}) {
  const [remaining, setRemaining] = useState(() => remainingOf(store, Date.now()))

  useEffect(() => {
    const sync = () => {
      const next = remainingOf(store, Date.now())
      setRemaining((prev) => (prev === next ? prev : next))
      if (store.running && next <= 0) onExpire(store.endsAt)
    }
    sync()
    if (!store.running) return
    const id = setInterval(sync, 250)
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [store, onExpire])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const total = storeSeconds(store)
  const progress = total > 0 ? 1 - remaining / total : 0

  return (
    <div className="relative w-[138px] h-[138px] md:w-[152px] md:h-[152px]">
      {/* 柔和极光背景环：运行中缓慢呼吸，待机保持极淡环境光晕 */}
      <span
        aria-hidden
        className={cn('absolute inset-0 rounded-full', store.running && 'focus-breathe')}
        style={{
          background: store.running
            ? 'radial-gradient(circle, color-mix(in srgb, var(--primary) 26%, transparent) 0%, transparent 68%)'
            : 'radial-gradient(circle, color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 64%)',
        }}
      />
      <svg viewBox="0 0 140 140" className="relative w-full h-full -rotate-90">
        <defs>
          <linearGradient id="focus-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--primary) 62%, #38BDF8)" />
          </linearGradient>
        </defs>
        {/* 表圈细刻度环：极简精密计时器质感 */}
        <circle
          cx="70" cy="70" r="50.5" fill="none"
          stroke="var(--outline-strong)" strokeWidth="1.25"
          strokeDasharray="1.4 6.53"
          opacity={store.running ? 0.65 : 0.42}
        />
        <circle cx="70" cy="70" r="60" fill="none" stroke="var(--surface-3)" strokeWidth="7.5" />
        <circle
          cx="70" cy="70" r="60" fill="none"
          stroke="url(#focus-ring-grad)"
          strokeWidth="7.5" strokeLinecap="round"
          strokeDasharray={`${Math.max(progress, 0.015) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          style={{
            transition: 'stroke-dasharray 1s linear',
            filter: store.running ? 'drop-shadow(0 0 8px var(--primary-glow))' : undefined,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-bold tracking-[-0.03em] leading-none tabular-nums text-on-surface">
          {mm}:{ss}
        </span>
        <span className="mt-1.5 text-[10.5px] font-semibold tracking-[0.12em] uppercase text-on-surface-2/80">
          {store.phase === 'work' ? 'FOCUS' : 'BREAK'}
        </span>
      </div>
    </div>
  )
}

/** 番茄钟：按墙上时钟计时（跨刷新/后台继续跑）+ 可选专注时长 + 会话落库（可绑定任务） */
export function FocusTimer({ initialTaskId }: { initialTaskId?: string }) {
  const [store, setStore] = useState<TimerStore>(loadStore)
  const [soundOn, setSoundOn] = useState<boolean>(isFocusSoundEnabled)
  // 必须用本地日期 + 跨午夜自动刷新
  const today = useDateTick()
  const todayStats = useLiveQuery(
    async () => {
      const rows = await db.focusSessions.where('day').equals(today).toArray()
      return { sessions: rows.length, minutes: rows.reduce((s, r) => s + r.minutes, 0) }
    },
    [today],
    { sessions: 0, minutes: 0 },
  )

  const all = useAllTasks()
  const candidates: Task[] = useMemo(
    () => sortTasks(all.filter((t) => t.status !== 'done')).slice(0, 50),
    [all],
  )
  const taskOptions = useMemo(
    () => [{ value: '', label: '不绑定任务' }, ...candidates.map((t) => ({ value: t.id, label: t.title }))],
    [candidates],
  )
  const [taskId, pickTask] = useFocusTaskId(initialTaskId)
  // 从任务详情点「开始专注」进来时，待选时的小框（值为任务 id）
  const [askTaskId, setAskTaskId] = useState<string | null>(null)
  const skipNextWriteRef = useRef(false)

  useEffect(() => {
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false
      return
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
    window.dispatchEvent(new CustomEvent(FOCUS_SYNC_EVENT))
  }, [store])

  // 当全局结算器在后台/本页完成结算后，立刻把本地视图同步到下一阶段
  useEffect(() => {
    const syncFromStorage = () => {
      const latest = loadStore()
      setStore((cur) => {
        if (cur.phase === latest.phase && cur.running === latest.running && cur.endsAt === latest.endsAt && cur.left === latest.left && cur.workMin === latest.workMin) return cur
        skipNextWriteRef.current = true
        return latest
      })
    }
    window.addEventListener(FOCUS_SYNC_EVENT, syncFromStorage)
    window.addEventListener('storage', syncFromStorage)
    return () => {
      window.removeEventListener(FOCUS_SYNC_EVENT, syncFromStorage)
      window.removeEventListener('storage', syncFromStorage)
    }
  }, [])

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

  // 到期交由全局结算器单点落库、播铃声与通知，保证只记一次且离页也能正常结算
  const handleExpire = useCallback((_endsAt: number) => {
    void _endsAt
    if (settleExpiredFocusTimer()) {
      skipNextWriteRef.current = true
      setStore(loadStore())
    }
  }, [])

  const maybeRequestDesktopNotify = () => {
    if (!isNative() && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined)
    }
  }

  const toggle = useCallback(() => {
    setStore((s) => {
      if (s.running) return { ...s, running: false, left: remainingOf(s, Date.now()), endsAt: 0 }
      maybeRequestDesktopNotify()
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
    maybeRequestDesktopNotify()
    setAskTaskId(null)
    setStore({ phase: 'work', running: true, endsAt: Date.now() + min * 60_000, left: min * 60, workMin: min })
  }, [])

  const boundTask = useMemo(() => all.find((t) => t.id === taskId && t.status !== 'done'), [all, taskId])
  const boundTitle = boundTask?.title
  const askTask = useMemo(() => (askTaskId ? all.find((t) => t.id === askTaskId) : undefined), [all, askTaskId])

  // 专注结束提醒：按 endsAt 排一条本地通知（锁屏/后台也能收到）；暂停、重置、结束时撤销
  useEffect(() => {
    if (!store.running || store.phase !== 'work') {
      void cancelFocusEnd()
      return
    }
    const body = boundTitle ? `「${boundTitle}」完成一轮专注` : `专注 ${store.workMin} 分钟结束`
    void scheduleFocusEnd(store.endsAt, body)
  }, [store.running, store.phase, store.endsAt, store.workMin, boundTitle])

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    setFocusSoundEnabled(next)
  }

  return (
    <div className="card p-4 md:p-5 flex flex-col items-center gap-3 md:gap-4 relative">
      <button
        type="button"
        onClick={toggleSound}
        aria-label={soundOn ? '关闭番茄结束提示音' : '开启番茄结束提示音'}
        title={soundOn ? '到点提示音：已开启' : '到点提示音：已静音'}
        className="absolute right-3.5 top-3.5 grid place-items-center size-8 rounded-lg text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
      >
        {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} className="opacity-65" />}
      </button>
      <div className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold border transition-colors',
        store.running
          ? 'bg-primary-soft/85 border-primary/25 text-primary'
          : 'bg-surface-2/90 border-outline/80 text-on-surface-2',
      )}>
        {store.running ? (
          <span aria-hidden className="ranking-live-dot" style={{ background: store.phase === 'work' ? 'var(--primary)' : 'var(--ok)' }} />
        ) : (
          <Timer size={13.5} className="opacity-80" aria-hidden />
        )}
        <span>
          {store.running ? (store.phase === 'work' ? '专注中' : '休息中') : '未开始'}
        </span>
      </div>

      {/* 圆形进度 + 时间 */}
      <CountdownDisplay store={store} onExpire={handleExpire} />

      {/* 专注时长：计时中不可改，改了会打断正在跑的这一个番茄 */}
      <div
        className={cn('w-full flex justify-center', store.running && 'opacity-50 pointer-events-none')}
        aria-disabled={store.running || undefined}
      >
        <Segmented
          ariaLabel="专注时长"
          asRadio
          touchSized
          disabled={store.running}
          size="sm"
          options={WORK_SEG_OPTIONS}
          value={String(store.workMin)}
          onChange={(v) => pickMinutes(Number(v))}
        />
      </div>

      {/* 控制跟随强调色；暂停态使用浅底描边，与运行态区分 */}
      <div className="flex items-center gap-3.5">
        <button
          onClick={toggle}
          className={cn(
            'grid place-items-center w-11 h-11 rounded-full cursor-pointer active:scale-95',
            'transition-[transform,background-color,color,box-shadow] duration-200',
            store.running
              ? 'bg-primary-soft text-primary ring-1 ring-primary/30 hover:bg-primary/20'
              : 'bg-primary-action text-on-primary-action btn-primary-glow hover:scale-105',
          )}
          aria-label={store.running ? '暂停' : '开始'}
        >
          {/* 32px 画布让播放三角形高约 17px，与 44px 按钮之间留出充足空隙 */}
          <PlayPauseIcon playing={store.running} size={32} />
        </button>
        <button
          onClick={reset}
          className="grid place-items-center w-11 h-11 rounded-full bg-surface-3 text-on-surface-2 hover:text-on-surface active:scale-95 transition-[transform,color,background-color] duration-200 cursor-pointer"
          aria-label="重置"
        >
          <RotateCcw size={17} />
        </button>
      </div>

      {/* 绑定任务：完成一个番茄即计入该任务耗时（自绘下拉，别用原生 select） */}
      <div className="w-full flex items-center gap-2">
        <Target size={14} className="text-on-surface-2 shrink-0" />
        <SelectMenu
          value={taskId}
          onChange={pickTask}
          ariaLabel="专注绑定任务"
          title="绑定任务"
          triggerClassName="flex-1 h-9 md:h-8 px-2.5 rounded-[10px] text-[12px]"
          options={taskOptions}
        />
      </div>
      {boundTask && (
        <p className="text-[11px] text-on-surface-2 -mt-2 text-center truncate w-full">
          本次完成将计入「{boundTask.title.slice(0, 18)}」
        </p>
      )}

      {/* 今日专注统计 */}
      <div className="flex items-center gap-2 text-[12px] text-on-surface-2 w-full justify-center">
        <Coffee size={14} />
        <span className="whitespace-nowrap">{`今日 ${todayStats.sessions} 个番茄 · ${todayStats.minutes} 分钟`}</span>
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
              className="h-12 rounded-[12px] bg-surface-2 border border-outline text-[15px] font-semibold hover:border-primary/60 hover:bg-primary/10 hover:text-primary active:scale-95 transition-colors cursor-pointer"
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
    if (initialTaskId) {
      setId(initialTaskId)
      try { localStorage.setItem(TASK_KEY, initialTaskId) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(FOCUS_SYNC_EVENT))
    }
  }, [initialTaskId])
  const pick = useCallback((next: string) => {
    setId(next)
    if (next) localStorage.setItem(TASK_KEY, next)
    else localStorage.removeItem(TASK_KEY)
    window.dispatchEvent(new CustomEvent(FOCUS_SYNC_EVENT))
  }, [])
  return [id, pick]
}
