import { cn } from '@/lib/cn'
import type { AppIcon } from '@/shared/icons'

interface Props {
  icon: AppIcon
  size?: 'md' | 'lg'
  className?: string
}

export function ToolIconTile({ icon: Icon, size = 'md', className }: Props) {
  const px = size === 'lg' ? 40 : 36
  return (
    <span
      aria-hidden
      className={cn(
        'tool-icon-tile grid shrink-0 place-items-center overflow-hidden',
        size === 'lg' ? 'size-10 rounded-[10px]' : 'size-9 rounded-[9px]',
        className,
      )}
    >
      <Icon size={px} className="size-full" />
    </span>
  )
}
