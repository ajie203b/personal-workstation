import { cn } from '@/lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** 可选：值后面的小徽标（如数量） */
  badge?: string
  /** 可选：前导色点（如优先级色） */
  dot?: string
}

interface Props<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
  ariaLabel?: string
}

/** 分段控件：MD3 segmented button 气质，用于清单/视图/主题切换 */
export function Segmented<T extends string>({ options, value, onChange, className, size = 'md', ariaLabel }: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-0.5 p-[3px] rounded-[12px] bg-surface-3/70', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap cursor-pointer',
              'transition-all duration-150 ease-standard',
              size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2.5 text-[12px]',
              active
                ? 'bg-surface text-on-surface shadow-sm'
                : 'text-on-surface-2 hover:text-on-surface',
            )}
          >
            {o.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />}
            {o.label}
            {o.badge != null && (
              <span
                className={cn(
                  'text-[11px] leading-none px-1.5 py-0.5 rounded-full',
                  active ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-on-surface-2',
                )}
              >
                {o.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
