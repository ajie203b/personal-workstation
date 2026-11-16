import { useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AppIcon } from '@/shared/icons'
import { cn } from '@/lib/cn'

const RADIO_DIRECTION: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** 可选：值后面的小徽标（如数量） */
  badge?: string
  /** 可选：前导色点（如优先级色） */
  dot?: string
  /** 可选：手机上只显示图标，文字到 md 才出现（省地方给窄屏） */
  icon?: LucideIcon | AppIcon
}

interface Props<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
  ariaLabel?: string
  touchSized?: boolean
  disabled?: boolean
  showLabels?: boolean
  asRadio?: boolean
}

/** 分段控件：滑块对齐选中项，宽度随标签和角标变化。 */
export function Segmented<T extends string>({ options, value, onChange, className, size = 'md', ariaLabel, touchSized, disabled, showLabels, asRadio }: Props<T>) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef(new Map<string, HTMLButtonElement>())
  const [thumb, setThumb] = useState<{ left: number; width: number; ready: boolean }>({ left: 0, width: 0, ready: false })

  // badge 计数变化（如今日 3→4）、字体加载完成、容器宽度变化都会改变按钮尺寸，
  // 只按 value/options.length/size 重测会让滑块宽度停留在旧值——改为观察按钮本身
  useLayoutEffect(() => {
    const btn = btnRefs.current.get(value)
    const wrap = wrapRef.current
    if (!btn || !wrap) return
    const measure = () => {
      // 弹层入场时可能在缩放，直接读布局尺寸以免滑块跟着缩小。
      const width = btn.offsetWidth
      if (!width) return
      const left = btn.offsetLeft
      setThumb((prev) =>
        prev.ready && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5
          ? prev
          : { left, width, ready: true },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    btnRefs.current.forEach((button) => ro.observe(button))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [value, options.length, size])

  return (
    <div
      ref={wrapRef}
      role={asRadio ? 'radiogroup' : 'tablist'}
      aria-label={ariaLabel}
      onKeyDown={asRadio ? (event) => {
        const direction = RADIO_DIRECTION[event.key]
        if (!direction || disabled || !options.length) return
        event.preventDefault()
        const current = options.findIndex(option => option.value === value)
        const next = options[(current + direction + options.length) % options.length]
        onChange(next.value)
        btnRefs.current.get(next.value)?.focus()
      } : undefined}
      className={cn('relative inline-flex items-center gap-0.5 p-[3px] rounded-[12px] bg-surface-3/70', className)}
    >
      <span
        aria-hidden
        className={cn(
          'segmented-thumb absolute left-0 top-[3px] bottom-[3px] rounded-[10px] bg-surface shadow-sm pointer-events-none',
          thumb.ready && 'transition-[transform,width] ease-standard',
        )}
        style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width, transitionDuration: thumb.ready ? 'var(--dur-2)' : undefined }}
      />
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) btnRefs.current.set(o.value, el)
              else btnRefs.current.delete(o.value)
            }}
            role={asRadio ? 'radio' : 'tab'}
            aria-label={o.label}
            aria-selected={asRadio ? undefined : active}
            aria-checked={asRadio ? active : undefined}
            tabIndex={asRadio && !active ? -1 : undefined}
            disabled={disabled}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-[1] inline-flex items-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap cursor-pointer select-none',
              'press',
              size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2.5 text-[12px]',
              touchSized && 'max-md:h-11 max-md:min-w-11',
              active ? 'text-on-surface' : 'text-on-surface-2 hover:text-on-surface',
            )}
          >
            {o.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />}
            {o.icon && <o.icon size={15} strokeWidth={active ? 2.2 : 1.9} className="shrink-0" />}
            <span className={cn(o.icon && !showLabels && 'hidden md:inline')}>{o.label}</span>
            {o.badge != null && (
              <span
                className={cn(
                  'text-[11px] leading-none px-1.5 py-0.5 rounded-full transition-colors duration-150',
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
