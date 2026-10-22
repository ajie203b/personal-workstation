import type { LucideIcon } from 'lucide-react'
import type { AppIcon } from '@/shared/icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  icon: LucideIcon | AppIcon
  title: string
  hint?: string
  children?: ReactNode
  compact?: boolean
  /** 紧凑空态：首页减少留白，让建议与专注控件靠近任务区 */
  dense?: boolean
  className?: string
}

/**
 * 空状态：图标 + 标题 + 提示 + 可选动作。在内容区内垂直居中（macOS 空态惯例）。
 *
 * dense 用于首页，桌面和手机都不强占固定的视口比例。
 */
export function EmptyState({ icon: Icon, title, hint, children, compact, dense, className }: Props) {
  const small = compact || dense
  return (
    <div className={cn(
      'empty-state text-center flex flex-col items-center justify-center',
      compact && 'py-7 my-0',
      !compact && !dense && 'py-8 md:py-14 min-h-[168px] md:min-h-[32vh]',
      !compact && dense && 'py-5 min-h-[128px]',
      className,
    )}
    >
      <div className={cn(
        'empty-icon bg-surface-2 border border-outline grid place-items-center mx-auto',
        small ? 'w-11 h-11 rounded-[12px] mb-2.5 md:mb-4' : 'w-14 h-14 rounded-[16px] mb-4',
      )}>
        <Icon size={small ? 19 : 24} strokeWidth={1.5} className="text-on-surface-2" />
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {/* dense：手机首屏放不下「图标+标题+说明+按钮+引导+专注控件」，
          说明文字在手机上收起（桌面照常显示），把高度让给下面真正要点的东西 */}
      {hint && <p className={cn('mt-1.5 max-w-md text-[13px] leading-relaxed text-on-surface-2 text-pretty', dense && !compact && 'hidden md:block')}>{hint}</p>}
      {children && <div className={dense ? 'mt-3 md:mt-4' : 'mt-4'}>{children}</div>}
    </div>
  )
}
