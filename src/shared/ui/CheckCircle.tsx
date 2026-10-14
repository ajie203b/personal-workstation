import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

interface Props {
  checked: boolean
  onChange: () => void
  className?: string
  label?: string
}

/** 微光点角度：不对称分布，比均匀放射更克制 */
const SPARK_ANGLES = [-90, -18, 54, 126, 198, 262]

/**
 * 特效播多久再真正提交完成状态。
 * 关键：任务完成后会立刻从列表移除（行被卸载），若不延迟提交，特效刚起播就被吃掉。
 */
const COMMIT_DELAY = 450

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 圆形勾选框：完成特效走「低调简洁、有高级感」的路线——
 * 绿底与对勾先本地呈现，一圈同色细光环从圆点外缘扩散淡出，6 粒同色微光点轻轻晕开；
 * 特效播到主段后再提交状态（任务随撤销 toast 离列表）。
 * 单色（状态绿）、短促、不撒花：只在「未完成→完成」播放，取消完成不放。
 * 延迟窗口内再点一次可反悔取消。减弱动效下整层跳过、立即提交。
 */
export function CheckCircle({ checked, onChange, className, label }: Props) {
  const [burst, setBurst] = useState(0)
  /** 提交前的本地「已勾选」视觉：绿底对勾先出现，特效播完再真正变更 */
  const [pendingDone, setPendingDone] = useState(false)
  const timer = useRef(0)

  // 卸载时清掉未提交的定时器，避免组件没了还写数据
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const click = (e: React.MouseEvent) => {
    e.stopPropagation()

    // 延迟窗口内再点一次 = 反悔：取消本次完成，不发生任何状态变更
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = 0
      setPendingDone(false)
      setBurst(0)
      haptic('light')
      return
    }

    if (!checked) {
      haptic('success')
      if (!prefersReduced()) {
        setBurst((n) => n + 1)
        setPendingDone(true)
        timer.current = window.setTimeout(() => {
          timer.current = 0
          setPendingDone(false)
          onChange()
        }, COMMIT_DELAY)
        return
      }
    } else {
      haptic('light')
    }
    onChange()
  }

  const shown = checked || pendingDone

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={shown}
      aria-label={label ?? '完成任务'}
      onClick={click}
      className={cn(
        'touch-target relative shrink-0 grid place-items-center w-[22px] h-[22px] mt-[2px] rounded-full border-[1.5px]',
        'transition-all duration-150 ease-standard cursor-pointer active:scale-90',
        shown
          ? 'bg-ok border-ok'
          : 'border-on-surface-2/60 hover:border-primary bg-transparent',
        // 弹跳只在完成瞬间播，挂在 burst 窗口上：列表里已完成项进场不再逐个乱蹦
        burst > 0 && 'animate-pop',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" aria-hidden>
        <path
          d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
          fill="none"
          stroke={shown ? 'var(--surface)' : 'transparent'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('check-path', shown && 'on')}
        />
      </svg>

      {burst > 0 && (
        <span key={burst} aria-hidden className="absolute inset-0 pointer-events-none">
          <span className="done-halo" />
          {SPARK_ANGLES.map((a, i) => (
            <span
              key={a}
              className="spark-dot"
              style={{ '--a': `${a}deg` } as React.CSSProperties}
              onAnimationEnd={i === 0 ? () => setBurst(0) : undefined}
            />
          ))}
        </span>
      )}
    </button>
  )
}
