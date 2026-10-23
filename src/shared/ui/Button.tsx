import {
  forwardRef, useCallback, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type MutableRefObject,
} from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { useMagnetic } from '@/lib/useMagnetic'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'destructive'
type Size = 'sm' | 'md' | 'icon'
/** 提交按钮三段变化：idle → loading → success/error → idle */
export type ButtonState = 'idle' | 'loading' | 'success' | 'error'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** 不传即 idle；受控用法配 useAsyncButton 自动流转 */
  state?: ButtonState
  /** 桌面/网页精细指针下的磁吸效果，只给核心 CTA 用 */
  magnetic?: boolean
}

// 背景与描边交给 .btn-fill 图层：加载时它收缩成圆形，按钮本身不动布局
const variantCls: Record<Variant, string> = {
  primary: 'text-on-primary-action hover:opacity-90 active:opacity-80',
  ghost: 'text-on-surface-2 hover:text-on-surface',
  outline: 'text-on-surface',
  danger: 'text-danger',
  destructive: 'text-on-danger hover:opacity-90 active:opacity-80',
}
const fillCls: Record<Variant, string> = {
  primary: 'bg-primary-action',
  ghost: 'bg-transparent group-hover:bg-surface-3',
  outline: 'bg-transparent ring-1 ring-inset ring-outline group-hover:bg-surface-3',
  danger: 'bg-transparent group-hover:bg-danger/10',
  destructive: 'bg-danger',
}
const sizeCls: Record<Size, string> = {
  sm: 'h-9 px-3 rounded-[10px] text-ui-caption gap-1.5 [--morph-size:36px]',
  md: 'h-10 px-4 rounded-[12px] text-ui-label gap-2 [--morph-size:40px]',
  icon: 'w-10 h-10 rounded-[10px] justify-center [--morph-size:40px]',
}
const stateCls: Record<ButtonState, string> = {
  idle: '',
  loading: 'text-on-surface-2',
  success: 'text-on-primary',
  error: 'text-on-primary',
}
const fillStateCls: Record<ButtonState, string> = {
  idle: '',
  loading: 'bg-surface-3 ring-1 ring-inset ring-outline',
  success: 'bg-ok',
  error: 'bg-danger',
}

/** 磁吸按钮的柔光跟随指针位置；普通按钮不渲染这一层 */
const magnetGlowCls: Record<Variant, string> = {
  primary: '[--magnet-glow:rgba(255,255,255,.3)]',
  ghost: '[--magnet-glow:color-mix(in_srgb,var(--primary)_16%,transparent)]',
  outline: '[--magnet-glow:color-mix(in_srgb,var(--primary)_16%,transparent)]',
  danger: '[--magnet-glow:color-mix(in_srgb,var(--danger)_16%,transparent)]',
  destructive: '[--magnet-glow:rgba(255,255,255,.3)]',
}

function StateIcon({ state }: { state: Exclude<ButtonState, 'idle'> }) {
  if (state === 'loading') {
    return (
      <svg className="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M21 12a9 9 0 1 1-6.2-8.56" />
      </svg>
    )
  }
  if (state === 'success') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path className="draw-check" d="M4 12.5 9.5 18 20 6.5" />
      </svg>
    )
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', size = 'md', type = 'button', state = 'idle', disabled, magnetic, children, ...rest },
  ref,
) {
  const busy = state !== 'idle'
  const localRef = useRef<HTMLButtonElement | null>(null)
  const setRefs = useCallback((node: HTMLButtonElement | null) => {
    localRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as MutableRefObject<HTMLButtonElement | null>).current = node
  }, [ref])
  useMagnetic(localRef, Boolean(magnetic) && !busy && !disabled)

  return (
    <button
      ref={setRefs}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-state={state}
      className={cn(
        'press group relative inline-flex items-center font-medium select-none',
        'transition-[color,opacity,transform] duration-150 ease-standard',
        !busy && disabled && 'opacity-45 pointer-events-none',
        variantCls[variant],
        sizeCls[size],
        stateCls[state],
        className,
      )}
      {...rest}
    >
      {/* 三连变：彩色层从整条按钮收缩成圆，文字随之淡出（只动绝对层，不挤布局） */}
      <span
        aria-hidden
        className={cn(
          'btn-fill absolute top-0 bottom-0 left-1/2 -translate-x-1/2',
          state === 'idle' && fillCls[variant],
          state === 'idle' && (variant === 'primary' || variant === 'destructive') && 'shadow-sm',
          fillStateCls[state],
        )}
        style={{
          width: busy ? 'var(--morph-size)' : '100%',
          borderRadius: busy ? 999 : 'inherit',
        }}
      />
      {magnetic && (
        <span aria-hidden className={cn('magnet-glow absolute inset-0 rounded-[inherit]', magnetGlowCls[variant])} />
      )}
      {/* 标签与状态图标叠在同一格：宽度由标签撑住，切换时不触发重排 */}
      <span className="relative z-10 grid place-items-center w-full [&>span]:col-start-1 [&>span]:row-start-1">
        <span
          data-magnetic-label={magnetic ? '' : undefined}
          className={cn('inline-flex items-center gap-1.5 transition-opacity duration-100', busy && 'opacity-0')}
        >
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
