import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'
type Size = 'sm' | 'md' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', size = 'md', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center font-medium select-none transition-all duration-150 ease-standard',
        'disabled:opacity-40 disabled:pointer-events-none',
        'active:scale-[0.97]',
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      {...rest}
    />
  )
})
