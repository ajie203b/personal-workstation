import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props { icon: LucideIcon; title: string; hint?: string; children?: ReactNode; compact?: boolean; className?: string }

/** 空状态：图标 + 标题 + 提示 + 可选动作。在内容区内垂直居中（macOS 空态惯例）。 */
export function EmptyState({ icon: Icon, title, hint, children, compact, className }: Props) {
  return (
    <div className={cn(
      'empty-state text-center flex flex-col items-center justify-center',
      compact ? 'py-8 my-0' : 'py-16 my-auto min-h-[42vh]',
      className,
    )}
    >
      <div className={`empty-icon ${compact ? 'w-11 h-11 rounded-[12px] mb-3' : 'w-14 h-14 rounded-[16px] mb-4'} bg-surface-2 border border-outline grid place-items-center mx-auto`}>
        <Icon size={compact ? 19 : 24} strokeWidth={1.5} className="text-on-surface-2" />
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-on-surface-2">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
