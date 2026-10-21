import { ArrowLeft, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  onClick: () => void
  label?: string
  /** 传入后显示图标 + 文字；不传则是 36px 图标按钮 */
  text?: string
  className?: string
}

/** 二级页统一返回入口：36px 热区，图标或「图标 + 文字」两种形态 */
export function BackButton({ onClick, label = '返回', text, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-1 h-9 rounded-[10px] text-[13px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer shrink-0',
        text ? 'px-2.5' : 'w-9 justify-center',
        className,
      )}
    >
      {text ? <ChevronLeft size={16} /> : <ArrowLeft size={18} />}
      {text && <span>{text}</span>}
    </button>
  )
}
