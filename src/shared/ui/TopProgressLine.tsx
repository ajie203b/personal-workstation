import { cn } from '@/lib/cn'

/**
 * 顶部极简细进度线（致敬文档工作站阅读进度条的 2px 简洁美学）：
 * - progress 为 0..1 数值时显示精确进度（平滑 scaleX 过渡）
 * - progress 为 null / undefined 时显示柔和流动细线（未知总大小或连接阶段，不让用户干等）
 * - 默认 absolute 贴合所在卡片/页面容器顶边（父级带 relative overflow-hidden 即可自动贴合圆角）
 */
export function TopProgressLine({
  active,
  progress,
  label,
  tone = 'primary',
  placement = 'absolute',
  className,
}: {
  active: boolean
  /** 0..1 的已知进度；传 null 或省略时展示流动不确定进度 */
  progress?: number | null
  label?: string
  tone?: 'primary' | 'danger' | 'ok'
  placement?: 'absolute' | 'sticky' | 'fixed'
  className?: string
}) {
  if (!active) return null
  const determinate = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0
  const clamped = determinate ? Math.max(0.03, Math.min(1, progress)) : 0
  const pct = determinate ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : undefined
  const barColor = tone === 'danger' ? 'bg-danger' : tone === 'ok' ? 'bg-ok' : 'bg-primary'

  return (
    <div
      role="progressbar"
      aria-label={label ?? '下载进度'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn(
        'pointer-events-none inset-x-0 top-0 z-20 h-[2.5px] overflow-hidden bg-primary/12',
        placement === 'fixed' ? 'fixed' : placement === 'sticky' ? 'sticky' : 'absolute',
        className,
      )}
    >
      {determinate ? (
        <div
          className={cn('h-full w-full origin-left transition-transform duration-200 ease-out', barColor)}
          style={{ transform: `scaleX(${clamped})` }}
        />
      ) : (
        <div className={cn('top-progress-indeterminate h-full w-2/5 rounded-full', barColor)} />
      )}
    </div>
  )
}
