import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { prefersReducedMotion } from '@/lib/motion'

interface Props {
  checked: boolean
  onChange: () => void
  className?: string
  label?: string
  /** 未来任务等场景：保留勾选框位置，但不可点 */
  disabled?: boolean
}

/** 反馈独立于任务行存活，任务立即提交、移除后仍能自然收尾。 */
function showCompletionFeedback(source: HTMLButtonElement) {
  if (prefersReducedMotion()) return
  const rect = source.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const feedback = source.cloneNode(true) as HTMLButtonElement
  feedback.removeAttribute('id')
  feedback.removeAttribute('title')
  feedback.setAttribute('aria-hidden', 'true')
  feedback.disabled = true
  feedback.tabIndex = -1
  Object.assign(feedback.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
    background: 'var(--ok)', borderColor: 'var(--ok)',
    pointerEvents: 'none', zIndex: '60',
  })
  const check = feedback.querySelector('path')
  check?.setAttribute('stroke', 'var(--surface)')
  if (check) check.style.strokeDashoffset = '0'
  const halo = document.createElement('span')
  halo.className = 'done-halo'
  feedback.appendChild(halo)
  document.body.appendChild(feedback)
  // 先压扁再弹起，随后缩小淡出：列表马上补位，停留太久会盖住下一行的勾选圈。
  // 撒花由 taskActions 从这颗按钮的位置单独触发。
  feedback.animate?.(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.14, 0.82)', opacity: 1, offset: 0.18 },
      { transform: 'scale(0.94, 1.06)', opacity: 1, offset: 0.42 },
      { transform: 'scale(0.86)', opacity: 0 },
    ],
    { duration: 300, easing: 'cubic-bezier(.22, 1.06, .36, 1)', fill: 'forwards' },
  )
  // 这里只延迟清理视觉节点，不延迟任何数据变更。
  window.setTimeout(() => feedback.remove(), 320)
}

export function CheckCircle({ checked, onChange, className, label, disabled }: Props) {

  return (
    <button
      type="button"
      role="checkbox"
      data-check-circle=""
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={label ?? '完成任务'}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        haptic(checked ? 'light' : 'success')
        if (!checked) showCompletionFeedback(e.currentTarget)
        onChange()
      }}
      className={cn(
        'touch-target relative shrink-0 grid place-items-center w-[22px] h-[22px] mt-[2px] rounded-full border-[1.5px]',
        'transition-[background-color,border-color,transform] duration-150 ease-standard cursor-pointer active:scale-95',
        disabled && 'opacity-40 cursor-not-allowed active:scale-100',
        checked
          ? 'bg-ok border-ok'
          : 'border-on-surface-2/50 hover:border-primary bg-transparent',
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

    </button>
  )
}
