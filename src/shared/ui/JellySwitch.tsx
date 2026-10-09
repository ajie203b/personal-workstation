import { useState } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

interface Props {
  checked: boolean
  onChange: () => void
  label?: string
  className?: string
}

/**
 * 果冻开关（动效方案 03）：圆点位移只用 transform，挤压走 knob-squash，
 * 底色用过渡。开关语义是"状态变了"，所以两档都轻震一下（selection）。
 * 位移量 = 轨道宽 44 - 左右内边距 2*2 - 圆点 20 = 20px，与原先 left 0.5→22px 等价。
 */
export function JellySwitch({ checked, onChange, label, className }: Props) {
  const [squash, setSquash] = useState(0)

  const click = () => {
    haptic('selection')
    setSquash((n) => n + 1)
    onChange()
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={click}
      className={cn(
        'relative w-11 h-6 rounded-full shrink-0 cursor-pointer transition-colors duration-200 ease-standard',
        checked ? 'bg-primary' : 'bg-surface-3 border border-outline',
        className,
      )}
    >
      <span
        className="absolute left-0.5 top-0.5 w-5 h-5 knob-slide"
        style={{ transform: `translateX(${checked ? 20 : 0}px)` }}
      >
        <span
          key={squash}
          className={cn('block w-5 h-5 rounded-full bg-white shadow', squash > 0 && 'knob-squash')}
        />
      </span>
    </button>
  )
}
