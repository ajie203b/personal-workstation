import { useState } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

interface Props {
  checked: boolean
  onChange: () => void
  className?: string
  label?: string
}

const ANGLES = [-90, -30, 30, 90, 150, 210]
const DOT_COLORS = ['var(--p1)', 'var(--ok)', 'var(--primary)', 'var(--p0)', 'var(--p2)', 'var(--ok)']

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 圆形勾选框：完成态填充状态绿 + 对勾描边 + 涟漪扩散（对标 Things 3 的完成反馈）。
 * 勾选瞬间补 6 粒爆点（动效方案 01 的拆用）：只在"未完成→完成"放，
 * 取消完成不放——反向撒花语义上很怪。减弱动效下整层跳过。
 */
export function CheckCircle({ checked, onChange, className, label }: Props) {
  const [burst, setBurst] = useState(0)

  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!checked) {
      haptic('success')
      if (!prefersReduced()) setBurst((n) => n + 1)
    } else {
      haptic('light')
    }
    onChange()
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? '完成任务'}
      onClick={click}
      className={cn(
        'touch-target relative shrink-0 grid place-items-center w-[22px] h-[22px] mt-[2px] rounded-full border-[1.5px]',
        'transition-all duration-150 ease-standard cursor-pointer active:scale-90',
        checked
          ? 'bg-ok border-ok animate-pop check-ripple'
          : 'border-on-surface-2/60 hover:border-primary bg-transparent',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" aria-hidden>
        <path
          d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
          fill="none"
          stroke={checked ? 'var(--surface)' : 'transparent'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('check-path', checked && 'on')}
        />
      </svg>

      {burst > 0 && (
        <span key={burst} aria-hidden className="absolute inset-0 pointer-events-none">
          {ANGLES.map((a, i) => (
            <span
              key={a}
              className="burst-dot"
              style={{ ['--a' as string]: `${a}deg`, background: DOT_COLORS[i] }}
              onAnimationEnd={i === 0 ? () => setBurst(0) : undefined}
            />
          ))}
        </span>
      )}
    </button>
  )
}
