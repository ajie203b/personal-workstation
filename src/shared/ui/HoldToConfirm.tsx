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
  /** 进度环直径（px），默认小巧的 18 */
  size?: number
  /** 视觉档次：danger=不可逆危险操作（红），neutral=普通确认（如恢复快照，用主题色） */
  variant?: 'danger' | 'neutral'
}

/**
 * 长按确认（动效方案 04）：按住蓄力走满才执行，中途松手进度倒退归零。
 * 计时内核在 useHoldToConfirm，这里只画进度环与兜底弹窗。
 * 造型：小巧进度环 + 文字标签的胶囊按钮，避免大圆饼占满按钮的廉价感。
 */
export function HoldToConfirm({
  onConfirm, label, dialogTitle, dialogDescription,
  holdMs = 1500, className, size = 18, variant = 'danger',
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { progress, nudging, bind } = useHoldToConfirm({
    holdMs,
    onComplete: onConfirm,
    onFallback: () => setDialogOpen(true),
  })

  const danger = variant === 'danger'
  const strokeWidth = size >= 24 ? 2.5 : 2
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const stroke = ringColor(progress, danger)

  return (
    <>
      <button
        type="button"
        aria-label={`${label}（按住 ${formatHoldSeconds(holdMs)} 秒确认）`}
        {...bind}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full select-none cursor-pointer',
          'transition-colors duration-150',
          danger
            ? 'bg-danger/10 text-danger hover:bg-danger/15 active:bg-danger/20'
            : 'bg-surface-3/70 text-on-surface-2 hover:bg-surface-3 hover:text-on-surface active:bg-surface-3',
          nudging && 'nudge',
          className,
        )}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
            style={{ transition: progress === 0 ? 'stroke-dashoffset 120ms linear' : 'none' }}
          />
        </svg>
        <span className="text-[13px] font-medium whitespace-nowrap">{label}</span>
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

/** 1.5 秒显示成「1.5」，别四舍五入成 2 秒和说明打架 */
function formatHoldSeconds(ms: number): string {
  const sec = ms / 1000
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1)
}

/** 进度环颜色：起步半透明 → 走满纯色，越接近完成越「确定」 */
function ringColor(p: number, danger: boolean): string {
  const token = danger ? 'var(--danger)' : 'var(--primary)'
  if (p < 0.34) return `color-mix(in srgb, ${token} 55%, transparent)`
  if (p < 0.67) return `color-mix(in srgb, ${token} 80%, transparent)`
  return token
}
