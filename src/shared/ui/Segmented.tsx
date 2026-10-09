import { useLayoutEffect, useRef, useState } from 'react'
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

/**
 * 分段控件（v1.4 动效升级）：MD3 segmented button 气质 + 滑块跟随。
 * 滑块按 left/width 过渡（--ease-emph），切换时平滑滑动而非瞬切。
 */
export function Segmented<T extends string>({ options, value, onChange, className, size = 'md', ariaLabel }: Props<T>) {
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
      if (!btn.offsetWidth) return
      const left = btn.getBoundingClientRect().left - wrap.getBoundingClientRect().left
      const width = btn.getBoundingClientRect().width
      setThumb((prev) =>
        prev.ready && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5
          ? prev
          : { left, width, ready: true },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(btn)
    if (wrap) ro.observe(wrap)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [value, options.length, size])

  // 切换时滑块先"拉长跨过中间距离"再收回到目标宽度（果冻开关的横向版）。
  // 只在 value 真的变化时触发，首帧和 badge 宽度校正不走这条路。
  const prevValue = useRef(value)
  useLayoutEffect(() => {
    const from = prevValue.current
    prevValue.current = value
    if (from === value) return
    const a = btnRefs.current.get(from)
    const b = btnRefs.current.get(value)
    const wrap = wrapRef.current
    if (!a || !b || !wrap) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const base = wrap.getBoundingClientRect().left
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    const left = Math.min(ra.left, rb.left) - base
    const span = Math.max(ra.right, rb.right) - Math.min(ra.left, rb.left)
    setThumb({ left, width: span, ready: true })
    const t = window.setTimeout(() => {
      // 重读一次矩形：150ms 内可能发生过滚动/缩放，缓存 rb 会算歪
      const wrapNow = wrapRef.current
      const btnNow = btnRefs.current.get(value)
      if (!wrapNow || !btnNow) return
      const r = btnNow.getBoundingClientRect()
      setThumb({ left: r.left - wrapNow.getBoundingClientRect().left, width: r.width, ready: true })
    }, 150)
    return () => clearTimeout(t)
  }, [value])

  return (
    <div
      ref={wrapRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('relative inline-flex items-center gap-0.5 p-[3px] rounded-[12px] bg-surface-3/70', className)}
    >
      {/* 滑块：left/width 相对 tablist 边框测量 */}
      <span
        aria-hidden
        className={cn(
          'absolute top-[3px] bottom-[3px] rounded-[10px] bg-surface shadow-sm pointer-events-none',
          thumb.ready && 'transition-[left,width] ease-emph',
        )}
        style={{ left: thumb.left, width: thumb.width, transitionDuration: thumb.ready ? '250ms' : undefined }}
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
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-[1] inline-flex items-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap cursor-pointer select-none',
              'transition-colors duration-150 ease-standard active:scale-[0.97]',
              size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2.5 text-[12px]',
              active ? 'text-on-surface' : 'text-on-surface-2 hover:text-on-surface',
            )}
          >
            {o.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />}
            {o.label}
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
