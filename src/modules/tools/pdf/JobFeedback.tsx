import { Button } from '@/shared/ui/Button'
import { TopProgressLine } from '@/shared/ui/TopProgressLine'
import type { PdfProgress } from './qpdfTypes'

export function JobFeedback({ busy, progress, error, onCancel }: {
  busy: boolean; progress: PdfProgress; error: string; onCancel: () => void
}) {
  const ratio = typeof progress.percent === 'number' && Number.isFinite(progress.percent) && progress.percent >= 0
    ? progress.percent / 100
    : null
  return <>
    {busy && <div className="relative overflow-hidden rounded-[12px] bg-surface-2 p-3 flex flex-col gap-2" role="status">
      <TopProgressLine active progress={ratio} label="PDF 处理进度" />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12px] tabular-nums">
          {progress.label || '准备处理…'}
          {ratio !== null ? ` · ${Math.round(ratio * 100)}%` : ''}
        </span>
        <Button size="sm" onClick={onCancel}>取消处理</Button>
      </div>
    </div>}
    {error && <p role="alert" className="text-[12px] text-danger break-words">{error}</p>}
  </>
}
