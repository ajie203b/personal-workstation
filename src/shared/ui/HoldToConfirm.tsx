import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'

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

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 长按确认（动效方案 04）：按住蓄力走满才执行，中途松手进度倒退归零。
 * 保留键盘路径：Enter/Space 直接弹二次确认框；减弱动效下长按也走弹窗，
 * 免得把"防误触"变成"防不了"。
 */
export function HoldToConfirm({
  onConfirm, label, dialogTitle, dialogDescription,
  holdMs = 1500, className, size = 40,
}: Props) {
  const [progress, setProgress] = useState(0)
  const [nudging, setNudging] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const raf = useRef(0)
  const backRaf = useRef(0)
  const startTs = useRef(0)
  const holding = useRef(false)

  const stopLoops = () => {
    cancelAnimationFrame(raf.current)
    cancelAnimationFrame(backRaf.current)
  }

  useEffect(() => stopLoops, [])

  const finish = useCallback(() => {
    holding.current = false
    stopLoops()
    setProgress(1)
    setNudging(true)
    haptic('success')
    setTimeout(() => setNudging(false), 280)
    setTimeout(() => {
      setProgress(0)
      onConfirm()
    }, 320)
  }, [onConfirm])

  const runForward = useCallback(() => {
    cancelAnimationFrame(backRaf.current)
    startTs.current = performance.now() - progress * holdMs
    const tick = (t: number) => {
      if (!holding.current) return
      const p = Math.min(1, (t - startTs.current) / holdMs)
      setProgress(p)
      if (p >= 1) finish()
      else raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [finish, holdMs, progress])

  const runBackward = useCallback(() => {
    cancelAnimationFrame(raf.current)
    holding.current = false
    let cur = progress
    const tick = () => {
      cur -= 0.07
      if (cur <= 0) {
        setProgress(0)
        return
      }
      setProgress(cur)
      backRaf.current = requestAnimationFrame(tick)
    }
    backRaf.current = requestAnimationFrame(tick)
  }, [progress])

  const onPointerDown = (e: React.PointerEvent) => {
    // 只 preventDefault 指针事件，不碰兼容性 mouse 事件：
    // adb / 自动化工具注入的是 mouse 序列，若一并取消会让按住完全无响应
    if (e.cancelable && e.nativeEvent.pointerType !== 'mouse') e.preventDefault()
    if (prefersReduced()) {
      setDialogOpen(true)
      return
    }
    holding.current = true
    haptic('medium')
    runForward()
  }

  const r = (size - 5) / 2
  const circ = 2 * Math.PI * r
  const stroke = nudgeColor(progress)

  return (
    <>
      <button
        type="button"
        aria-label={`${label}（按住 ${Math.round(holdMs / 1000)} 秒确认）`}
        onPointerDown={onPointerDown}
        onPointerUp={runBackward}
        onPointerLeave={runBackward}
        onPointerCancel={runBackward}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setDialogOpen(true)
          }
        }}
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
