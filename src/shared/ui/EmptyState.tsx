import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props { icon: LucideIcon; title: string; hint?: string; children?: ReactNode }

/** 空状态：图标 + 标题 + 提示 + 可选动作。在内容区内垂直居中（macOS 空态惯例）。 */
export function EmptyState({ icon: Icon, title, hint, children }: Props) {
  return (
    <div className="text-center py-16 my-auto min-h-[42vh] flex flex-col items-center justify-center">
      <div className="w-14 h-14 rounded-[16px] bg-surface-2 border border-outline grid place-items-center mx-auto mb-4">
        <Icon size={24} strokeWidth={1.5} className="text-on-surface-2" />
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {hint && <p className="mt-1 text-[13px] text-on-surface-2">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
