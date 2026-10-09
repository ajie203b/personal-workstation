import {
  forwardRef, useCallback, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type PointerEvent as ReactPointerEvent,
} from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md' | 'icon'
/** 提交按钮三段变化：idle → loading → success/error → idle */
export type ButtonState = 'idle' | 'loading' | 'success' | 'error'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** 不传即 idle；受控用法配 useAsyncButton 自动流转 */
  state?: ButtonState
  /** 触点水波纹（MD3 语义）。primary 默认开，其余默认关以守住 HIG 克制基调 */
  ripple?: boolean
}

const variantCls: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90 active:opacity-80 shadow-sm',
  ghost: 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
  outline: 'border border-outline text-on-surface hover:bg-surface-3',
  danger: 'text-danger hover:bg-danger/10',
}

const sizeCls: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-[10px] gap-1.5',
  md: 'h-10 px-4 text-[14px] rounded-[10px] gap-2',
  icon: 'h-10 w-10 rounded-[10px] justify-center',
}

/** 状态态下的底色：成功走 --ok，失败走 --danger，加载保持原色 */
const stateCls: Record<ButtonState, string> = {
  idle: '',
  loading: '',
  success: 'bg-ok text-on-primary border-transparent',
  error: 'bg-danger text-on-primary border-transparent',
}

/** 状态图标：纯 SVG，成功态带描边画勾动画 */
function StateIcon({ state }: { state: ButtonState }) {
  if (state === 'loading') {
    return <span aria-hidden className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
  }
  if (state === 'success') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden>
        <path d="M4 12.5 L9.5 18 L20 6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="draw-check" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden>
      <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

interface Ripple { id: number; x: number; y: number; size: number }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', size = 'md', type = 'button', state = 'idle', ripple, disabled, children, onPointerDown, ...rest },
  ref,
) {
  const [ripples, setRipples] = useState<Ripple[]>([])
  const seed = useRef(0)
  const showRipple = ripple ?? variant === 'primary'
  const busy = state !== 'idle'

  const spawnRipple = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(e)
    if (!showRipple || busy) return
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const d = Math.max(rect.width, rect.height)
    const id = ++seed.current
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left - d / 2, y: e.clientY - rect.top - d / 2, size: d }])
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 480)
  }, [onPointerDown, showRipple, busy])

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-state={state}
      onPointerDown={spawnRipple}
      className={cn(
        'press relative overflow-hidden inline-flex items-center font-medium select-none',
        'transition-all duration-150 ease-standard',
        'disabled:opacity-45 disabled:pointer-events-none',
        variantCls[variant],
        sizeCls[size],
        stateCls[state],
        busy && 'rounded-full justify-center',
        className,
      )}
      {...rest}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          className="ripple"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
          aria-hidden
        />
      ))}
      {/* 标签与状态图标叠在同一格：宽度由标签撑住，切换时不触发重排 */}
      <span className="grid place-items-center w-full [&>span]:col-start-1 [&>span]:row-start-1">
        <span
          className={cn(
            'inline-flex items-center gap-2 transition-opacity duration-150',
            busy && 'opacity-0',
          )}
        >
          {children}
        </span>
        {busy && (
          <span className="inline-flex items-center justify-center animate-pop">
            <StateIcon state={state} />
          </span>
        )}
      </span>
    </button>
  )
})

/**
 * 把一次异步操作驱动成三段变化：loading → success/error，短暂停留后回 idle。
 * 失败一定落到 error，不能骗人打勾。
 */
export function useAsyncButton(opts?: { successHoldMs?: number; errorHoldMs?: number }) {
  const [state, setState] = useState<ButtonState>('idle')
  const timers = useRef<number[]>([])
  const alive = useRef(true)

  useEffect(() => () => {
    alive.current = false
    timers.current.forEach((t) => clearTimeout(t))
  }, [])

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(() => alive.current && fn(), ms))
  }

  const run = useCallback(
    async <T,>(fn: () => Promise<T> | T): Promise<T | undefined> => {
      setState('loading')
      haptic('light')
      try {
        const out = await fn()
        setState('success')
        haptic('success')
        later(opts?.successHoldMs ?? 1100, () => setState('idle'))
        return out
      } catch (err) {
        setState('error')
        haptic('error')
        later(opts?.errorHoldMs ?? 1400, () => setState('idle'))
        throw err
      }
    },
    [opts?.successHoldMs, opts?.errorHoldMs],
  )

  return { state, run }
}
