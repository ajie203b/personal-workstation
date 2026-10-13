import { useState } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { useHoldToConfirm } from '@/shared/ui/useHoldToConfirm'

interface Props {
  /** 走满或键盘确认后执行 */
  onConfirm: () => void
  label: string
  /** 键盘/减弱动效兜底弹窗的文案 */
  dialogTitle: string
  dialogDescription?: string
  holdMs?: number
  className?: string
  size?: number
}

/**
 * 长按确认（动效方案 04）：按住蓄力走满才执行，中途松手进度倒退归零。
 * 计时内核在 useHoldToConfirm，这里只画圆环与兜底弹窗。
 */
export function HoldToConfirm({
  onConfirm, label, dialogTitle, dialogDescription,
  holdMs = 1500, className, size = 40,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { progress, nudging, bind } = useHoldToConfirm({
    holdMs,
    onComplete: onConfirm,
    onFallback: () => setDialogOpen(true),
  })

  const r = (size - 5) / 2
  const circ = 2 * Math.PI * r
  const stroke = nudgeColor(progress)

  return (
    <>
      <button
        type="button"
        aria-label={`${label}（按住 ${Math.round(holdMs / 1000)} 秒确认）`}
        {...bind}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 h-9 px-3.5 rounded-full select-none cursor-pointer',
          'bg-danger/10 text-danger transition-colors duration-150 hover:bg-danger/15 active:bg-danger/20',
          nudging && 'nudge',
          className,
        )}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.5} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={stroke} strokeWidth={2.5} strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
            style={{ transition: progress === 0 ? 'stroke-dashoffset 120ms linear' : 'none' }}
          />
        </svg>
        <span className="text-[13px] font-medium whitespace-nowrap -ml-1">{label}</span>
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title={dialogTitle} description={dialogDescription}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              setDialogOpen(false)
              haptic('medium')
              onConfirm()
            }}
          >
            确认
          </Button>
        </div>
      </Dialog>
    </>
  )
}

/** 进度环颜色：红 → 更深红，越接近走满越"危险" */
function nudgeColor(p: number): string {
  if (p < 0.34) return 'color-mix(in srgb, var(--danger) 55%, transparent)'
  if (p < 0.67) return 'color-mix(in srgb, var(--danger) 80%, transparent)'
  return 'var(--danger)'
}
