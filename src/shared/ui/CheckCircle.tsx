import { cn } from '@/lib/cn'

interface Props {
  checked: boolean
  onChange: () => void
  className?: string
  label?: string
}

/** 圆形勾选框：完成态填充状态绿 + 对勾描边动画（150ms standard） */
export function CheckCircle({ checked, onChange, className, label }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? '完成任务'}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={cn(
        'shrink-0 grid place-items-center w-[22px] h-[22px] mt-[2px] rounded-full border-[1.5px]',
        'transition-all duration-150 ease-standard cursor-pointer',
        checked
          ? 'bg-ok border-ok animate-pop'
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
    </button>
  )
}
