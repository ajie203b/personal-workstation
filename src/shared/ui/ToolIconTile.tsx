import { cn } from '@/lib/cn'
import type { AppIcon } from '@/shared/icons'

interface Props {
  icon: AppIcon
  size?: 'md' | 'lg'
  className?: string
}

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
      <Icon size={px} className="size-full" />
    </span>
  )
}
