import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Coffee, Timer } from 'lucide-react'

const STORE_KEY = 'ws-focus-timer'

export interface FocusTicker {
  running: boolean
  left: number
  phase: 'work' | 'break'
  taskTitle?: string
}

function readState(): FocusTicker | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as { running?: boolean; endsAt?: number; left?: number; phase?: 'work' | 'break'; workMin?: number }
    if (!s.running || !s.endsAt) return null
    const total = (s.phase === 'break' ? 5 : (s.workMin ?? 25)) * 60
    const left = Math.max(0, Math.min(total, Math.ceil((s.endsAt - Date.now()) / 1000)))
    if (left <= 0) return null
    let taskTitle: string | undefined
    try {
      const t = JSON.parse(localStorage.getItem('ws-focus-task') ?? 'null') as { title?: string } | null
      taskTitle = t?.title
    } catch { /* ignore */ }
    return { running: true, left, phase: s.phase ?? 'work', taskTitle }
  } catch {
    return null
  }
}

/**
 * 番茄钟迷你条：计时中常驻在底栏上方，切到任何页面都看得到（手机上原来得滑到今日页才见着）。
 * 只读 localStorage 里的同一份计时存储，不接管状态 —— 点一下回今日页展开完整番茄钟。
 */
export function useFocusTicker(): FocusTicker | null {
  const [state, setState] = useState<FocusTicker | null>(readState)
  useEffect(() => {
    const tick = () => setState(readState())
    const id = window.setInterval(tick, 1000)
    window.addEventListener('storage', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('storage', tick)
      window.removeEventListener('focus', tick)
    }
  }, [])
  return state
}

/**
 * 只回答「有没有在计时」。
 *
 * 外壳（AppShell）需要它来给悬浮按钮让位，但外壳每秒重渲染会把整页（包括几百页的 PDF）一起带走。
 * 这里每秒读一次存储，只有 true/false 真的翻转时 setState 才会触发渲染。
 */
export function useFocusActive(): boolean {
  const [active, setActive] = useState(() => readState() !== null)
  useEffect(() => {
    const tick = () => setActive(readState() !== null)
    const id = window.setInterval(tick, 1000)
    window.addEventListener('storage', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('storage', tick)
      window.removeEventListener('focus', tick)
    }
  }, [])
  return active
}

export function FocusMiniBar() {
  const state = useFocusTicker()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 已经在今日页就不用这条了（完整番茄钟就在页面上）
  if (!state || pathname === '/today' || pathname.startsWith('/docs/') || pathname === '/review') return null
  const mm = Math.floor(state.left / 60)
  const ss = state.left % 60
  return (
    <button
      type="button"
      onClick={() => navigate('/today')}
      className="md:hidden fixed left-3 right-[4.75rem] z-30 h-11 rounded-full bg-surface border border-outline shadow-lg flex items-center gap-2 px-3.5 cursor-pointer active:scale-[0.98] transition-transform"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4.25rem)' }}
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
