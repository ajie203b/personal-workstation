import {
  forwardRef, useCallback, useEffect, useRef, useState,
  type ButtonHTMLAttributes,
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
}

const variantCls: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90 active:opacity-80 shadow-sm',
  ghost: 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
  outline: 'border border-outline text-on-surface hover:bg-surface-3',
  danger: 'text-danger hover:bg-danger/10',
}
const sizeCls: Record<Size, string> = {
  sm: 'h-9 px-3 rounded-[10px] text-ui-caption gap-1.5',
  md: 'h-10 px-4 rounded-[12px] text-ui-label gap-2',
  icon: 'w-10 h-10 rounded-[10px] justify-center',
}
const stateCls: Record<ButtonState, string> = {
  idle: '',
  loading: 'bg-surface-3 text-on-surface-2 border border-outline shadow-none',
  success: 'bg-ok text-on-primary hover:opacity-100 shadow-none',
  error: 'bg-danger text-on-primary hover:opacity-100 shadow-none',
}

function StateIcon({ state }: { state: Exclude<ButtonState, 'idle'> }) {
  if (state === 'loading') {
    return (
      <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M21 12a9 9 0 1 1-6.2-8.56" />
      </svg>
    )
  }
  if (state === 'success') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12.5 9.5 18 20 6.5" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', size = 'md', type = 'button', state = 'idle', disabled, children, ...rest },
  ref,
) {
  const busy = state !== 'idle'

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-state={state}
      className={cn(
        'press relative overflow-hidden inline-flex items-center font-medium select-none',
        'transition-[background-color,color,border-color,opacity,transform,border-radius] duration-150 ease-standard',
        'disabled:opacity-45 disabled:pointer-events-none',
        variantCls[variant],
        sizeCls[size],
        stateCls[state],
        busy && 'rounded-full justify-center',
        className,
      )}
      {...rest}
    >
      {/* 标签与状态图标叠在同一格：宽度由标签撑住，切换时不触发重排 */}
      <span className="grid place-items-center w-full [&>span]:col-start-1 [&>span]:row-start-1">
        <span className={cn('inline-flex items-center gap-1.5 transition-opacity duration-100', busy && 'opacity-0')}>
          {children}
        </span>
        <span
          className={cn(
            'inline-flex items-center justify-center transition-[opacity,transform] duration-150',
            busy ? 'opacity-100 scale-100' : 'opacity-0 scale-75',
          )}
          aria-hidden={!busy}
        >
          {busy && <StateIcon state={state} />}
        </span>
      </span>
    </button>
  )
})

/**
 * 触发即进 loading，Promise 完成后展示结果态再归位（默认 700ms，可按调用点覆盖）。
 * 用法：
 *   const backup = useAsyncButton()
 *   <Button state={backup.state} onClick={() => backup.run(() => backupNow())}>立即备份</Button>
 */
export function useAsyncButton(opts?: { successHoldMs?: number; errorHoldMs?: number }) {
  const [state, setState] = useState<ButtonState>('idle')
  const timerRef = useRef(0)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const holdThenIdle = useCallback((ms: number) => {
    clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setState('idle'), ms)
  }, [])

  const run = useCallback(async (fn: () => Promise<unknown> | void) => {
    setState('loading')
    try {
      await fn()
      setState('success')
      haptic('success')
      holdThenIdle(opts?.successHoldMs ?? 700)
    } catch (e) {
      setState('error')
      console.error(e)
      holdThenIdle(opts?.errorHoldMs ?? 700)
    }
  }, [holdThenIdle, opts?.successHoldMs, opts?.errorHoldMs])

  return { state, run }
}
