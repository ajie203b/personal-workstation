import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 select-none">
      <div className="grid place-items-center w-16 h-16 rounded-full border border-outline bg-surface-2 text-on-surface-2/80 mb-4">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <p className="text-[15px] font-medium text-on-surface">{title}</p>
      {hint && <p className="mt-1.5 text-[13px] text-on-surface-2 max-w-[320px] leading-relaxed">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
