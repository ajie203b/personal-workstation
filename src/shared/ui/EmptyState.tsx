import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  icon: LucideIcon
  title: string
  hint?: string
  children?: ReactNode
  compact?: boolean
  /** 只在手机上收紧（首页空态用）：桌面留白不变，手机把下面那块内容露出来 */
  dense?: boolean
  className?: string
}

/**
 * 空状态：图标 + 标题 + 提示 + 可选动作。在内容区内垂直居中（macOS 空态惯例）。
 *
 * dense = 仅手机收紧。首屏高度只有 844，空态按桌面比例留白会把专注控件整个顶下去，
 * 所以手机上把内边距、图标、最小高度一起收掉，桌面保持原来的呼吸感。
 */
export function EmptyState({ icon: Icon, title, hint, children, compact, dense, className }: Props) {
  const small = compact || dense
  return (
    <div className={cn(
      'empty-state text-center flex flex-col items-center justify-center',
      compact && 'py-7 my-0',
      !compact && !dense && 'py-8 md:py-14 min-h-[168px] md:min-h-[32vh]',
      !compact && dense && 'py-5 md:py-14 min-h-[128px] md:min-h-[32vh]',
      className,
    )}
    >
      <div className={cn(
        'empty-icon bg-surface-2 border border-outline grid place-items-center mx-auto',
        small ? 'w-11 h-11 rounded-[12px] mb-2.5 md:mb-4' : 'w-14 h-14 rounded-[16px] mb-4',
        dense && !compact && 'md:w-14 md:h-14 md:rounded-[16px] md:mb-4',
      )}>
        <Icon size={small ? 19 : 24} strokeWidth={1.5} className="text-on-surface-2" />
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {/* dense：手机首屏放不下「图标+标题+说明+按钮+引导+专注控件」，
          说明文字在手机上收起（桌面照常显示），把高度让给下面真正要点的东西 */}
      {hint && <p className={cn('mt-1.5 max-w-md text-ui-caption leading-relaxed text-on-surface-2 text-pretty', dense && !compact && 'hidden md:block')}>{hint}</p>}
      {children && <div className={dense ? 'mt-3 md:mt-4' : 'mt-4'}>{children}</div>}
    </div>
  )
}
