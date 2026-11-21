import { cn } from '@/lib/cn'
import type { AppIcon } from '@/shared/icons'

interface Props {
  icon: AppIcon
  size?: 'md' | 'lg'
  className?: string
}

/**
 * 统一的小工具瓷白方砖图标容器（工具目录 + 10 个子页标题共用）。
 * Apple Squircle 质感阴影 + 高光微边，让 8 枚自绘图标与番茄小说 / 安娜的档案浑然一体。
 */
export function ToolIconTile({ icon: Icon, size = 'md', className }: Props) {
  const px = size === 'lg' ? 50 : 44
  return (
    <span
      aria-hidden
      className={cn(
        'tool-icon-tile grid shrink-0 place-items-center overflow-hidden',
        size === 'lg' ? 'size-[50px] rounded-[14px]' : 'size-11 rounded-[12.5px]',
        className,
      )}
    >
      <Icon size={px} className="w-full h-full" />
    </span>
  )
}
