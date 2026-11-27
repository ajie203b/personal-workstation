import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Coffee, Timer } from 'lucide-react'
import { db } from '@/db/db'
import { addFocusSession } from '@/db/focus'
import { haptic } from '@/lib/haptics'
import { isNative } from '@/lib/native'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'

const STORE_KEY = 'ws-focus-timer'
const TASK_KEY = 'ws-focus-task'
const SOUND_KEY = 'ws-focus-sound'
const BREAK_MIN = 5

export const FOCUS_SYNC_EVENT = 'ws:focus-sync'

export interface FocusTicker {
  running: boolean
  left: number
  phase: 'work' | 'break'
  taskId?: string
  legacyTitle?: string
}

interface RawTimerStore {
  phase?: 'work' | 'break'
  running?: boolean
  endsAt?: number
  left?: number
  workMin?: number
}

export function isFocusSoundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
}

export function setFocusSoundEnabled(enabled: boolean): void {
  try { localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off') } catch { /* ignore */ }
}

/** 轻柔两音铃声（Web Audio 合成，零外部音频资源，默认开启且可一键静音） */
export function playFocusChime(): void {
  if (!isFocusSoundEnabled()) return
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [523.25, 783.99] // C5 → G5 柔和五度
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.16)
      gain.gain.setValueAtTime(0.0001, now + i * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.16 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.55)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.16)
      osc.stop(now + i * 0.16 + 0.6)
    })
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1200)
  } catch { /* 无音频权限时静默 */ }
}

/** 网页 / 桌面端系统通知（安卓走 Capacitor LocalNotifications） */
export function notifyFocusDesktop(title: string, body: string): void {
  if (isNative() || typeof Notification === 'undefined') return
  try {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: './icons/icon-192.png' })
    }
  } catch { /* ignore */ }
}

function readTaskMeta(): { taskId?: string; legacyTitle?: string } {
  try {
    const raw = localStorage.getItem(TASK_KEY)
    if (!raw) return {}
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { id?: string; title?: string } | null
      return { taskId: parsed?.id, legacyTitle: parsed?.title }
    }
    return { taskId: raw }
  } catch {
    return {}
  }
}

function readRawStore(): RawTimerStore | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as RawTimerStore
  } catch {
    return null
  }
}

function readState(): FocusTicker | null {
  const s = readRawStore()
  if (!s?.running || !s.endsAt) return null
  const workMin = Number(s.workMin) > 0 ? Number(s.workMin) : 25
  const total = (s.phase === 'break' ? BREAK_MIN : workMin) * 60
  const left = Math.max(0, Math.min(total, Math.ceil((s.endsAt - Date.now()) / 1000)))
  if (left <= 0) return null
  const { taskId, legacyTitle } = readTaskMeta()
  return { running: true, left, phase: s.phase ?? 'work', taskId, legacyTitle }
}

let lastGlobalSettledEndsAt = 0

/**
 * 全局番茄到期结算：挂在 App 根部，即使离开今日页去读 PDF/做任务，到点仍准时按 endsAt 真实日期入库、
 * 播轻柔提示音、发桌面通知并弹出 Toast，避免离页漏记或次日错记。
 */
export function settleExpiredFocusTimer(): boolean {
  const s = readRawStore()
  if (!s?.running || !s.endsAt || s.endsAt > Date.now()) return false
  if (lastGlobalSettledEndsAt === s.endsAt) return false
  lastGlobalSettledEndsAt = s.endsAt
  const phase = s.phase === 'break' ? 'break' : 'work'
  const workMin = Number(s.workMin) > 0 ? Number(s.workMin) : 25
  const nextPhase = phase === 'work' ? 'break' : 'work'
  const nextLeft = (nextPhase === 'work' ? workMin : BREAK_MIN) * 60
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      phase: nextPhase,
      running: false,
      endsAt: 0,
      left: nextLeft,
      workMin,
    }))
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(FOCUS_SYNC_EVENT))

  const finishedWork = phase === 'work'
  const endsAt = s.endsAt
  const { taskId } = readTaskMeta()
  if (finishedWork) {
    void (async () => {
      let validTaskId: string | undefined
      if (taskId) {
        const t = await db.tasks.get(taskId)
        if (t && t.status !== 'done') validTaskId = t.id
      }
      await addFocusSession(workMin, validTaskId, endsAt)
    })()
  }
  const msg = finishedWork ? `专注 ${workMin} 分钟完成，休息 ${BREAK_MIN} 分钟` : '休息结束，可以开始下一个番茄'
  useUi.getState().toast(msg)
  haptic('success')
  playFocusChime()
  notifyFocusDesktop(finishedWork ? '专注结束' : '休息结束', msg)
  return true
}

export function FocusGlobalSettlement() {
  useEffect(() => {
    const check = () => { settleExpiredFocusTimer() }
    check()
    const id = window.setInterval(check, 1000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])
  return null
}

/**
 * 番茄钟迷你条状态：监听本地存储 + FOCUS_SYNC_EVENT，切页零延迟。
 */
export function useFocusTicker(): (FocusTicker & { taskTitle?: string }) | null {
  const [state, setState] = useState<FocusTicker | null>(readState)
  useEffect(() => {
    const tick = () => setState(readState())
    const id = window.setInterval(tick, 1000)
    window.addEventListener('storage', tick)
    window.addEventListener('focus', tick)
    window.addEventListener(FOCUS_SYNC_EVENT, tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('storage', tick)
      window.removeEventListener('focus', tick)
      window.removeEventListener(FOCUS_SYNC_EVENT, tick)
    }
  }, [])
  const taskId = state?.taskId
  const taskTitle = useLiveQuery(
    async () => (taskId ? (await db.tasks.get(taskId))?.title : undefined),
    [taskId],
    undefined,
  )
  if (!state) return null
  return { ...state, taskTitle: taskTitle ?? state.legacyTitle }
}

/** 浮层只在计时状态开始或结束时更新位置。 */
export function useFocusActive(): boolean {
  const [active, setActive] = useState(() => readState() !== null)
  useEffect(() => {
    const tick = () => setActive(readState() !== null)
    const id = window.setInterval(tick, 1000)
    window.addEventListener('storage', tick)
    window.addEventListener('focus', tick)
    window.addEventListener(FOCUS_SYNC_EVENT, tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('storage', tick)
      window.removeEventListener('focus', tick)
      window.removeEventListener(FOCUS_SYNC_EVENT, tick)
    }
  }, [])
  return active
}

export function FocusMiniBar({ besideAddButton }: { besideAddButton: boolean }) {
  const state = useFocusTicker()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 已经在今日页就不用这条了（完整番茄钟就在页面上）
  if (!state || pathname === '/today' || pathname.startsWith('/docs/')) return null
  const mm = Math.floor(state.left / 60)
  const ss = state.left % 60
  return (
    <button
      type="button"
      onClick={() => navigate('/today')}
      className="mobile-actions-offset mini-bar-in press bg-surface md:hidden fixed left-[calc(.75rem+env(safe-area-inset-left))] z-30 h-12 rounded-full border border-outline shadow-[var(--elev-card)] flex items-center gap-2 px-3.5 cursor-pointer"
      style={{ right: `calc(${besideAddButton ? '4.25rem' : '.75rem'} + env(safe-area-inset-right, 0px))` }}
      aria-label={`番茄钟剩余 ${mm} 分 ${ss} 秒，点开今日页`}
    >
      <span className={state.phase === 'break' ? 'text-ok' : 'text-primary'}>
        {state.phase === 'break' ? <Coffee size={15} /> : <Timer size={15} />}
      </span>
      <span className="text-[13px] font-semibold tabular-nums">
        {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
      </span>
      <span className="text-[12px] text-on-surface-2 truncate flex-1 text-left">
        {state.phase === 'break' ? '休息中' : state.taskTitle ? state.taskTitle : '专注中'}
      </span>
      <span className="text-[11px] text-primary shrink-0">展开</span>
    </button>
  )
}

/** 桌面/平板侧栏迷你专注胶囊：离开今日页后依然随时掌握倒计时，点击一键回到今日页 */
export function DesktopFocusPill({ collapsed }: { collapsed: boolean }) {
  const state = useFocusTicker()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (!state || pathname === '/today') return null
  const mm = String(Math.floor(state.left / 60)).padStart(2, '0')
  const ss = String(state.left % 60).padStart(2, '0')
  const label = state.phase === 'break' ? '休息中' : (state.taskTitle || '专注中')
  return (
    <div className="px-2.5 pb-2 shrink-0">
      <button
        type="button"
        onClick={() => navigate('/today')}
        title={`${label} · 剩余 ${mm}:${ss}（点击回今日页）`}
        aria-label={`${label}，剩余 ${mm} 分 ${ss} 秒，点击回今日页`}
        className={cn(
          'w-full flex items-center rounded-[12px] border border-primary/25 bg-primary-soft/80 text-primary hover:bg-primary/15 transition-colors cursor-pointer select-none',
          collapsed ? 'flex-col justify-center gap-0.5 py-1.5 px-1' : 'justify-center py-1.5 px-1 lg:flex-row lg:justify-start lg:gap-2 lg:px-2.5 lg:py-2',
        )}
      >
        <span className={cn('shrink-0', state.phase === 'break' ? 'text-ok' : 'text-primary')}>
          {state.phase === 'break' ? <Coffee size={14} /> : <Timer size={14} />}
        </span>
        <span className="text-[11.5px] font-bold tabular-nums leading-none">{mm}:{ss}</span>
        {!collapsed && (
          <span className="hidden lg:block text-[11.5px] text-on-surface-2 truncate flex-1 text-left">
            {label}
          </span>
        )}
      </button>
    </div>
  )
}
