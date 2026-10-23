import { Button } from '@/shared/ui/Button'
import type { PdfProgress } from './qpdfTypes'

export function JobFeedback({ busy, progress, error, onCancel }: {
  busy: boolean; progress: PdfProgress; error: string; onCancel: () => void
}) {
  return <>
    {busy && <div className="rounded-[12px] bg-surface-2 p-3 flex flex-col gap-2" role="status">
      <div className="flex items-center gap-2"><span className="flex-1 text-[12px]">{progress.label || '准备处理…'}</span><Button size="sm" onClick={onCancel}>取消处理</Button></div>
      <progress aria-label="PDF 处理进度" max={100} value={progress.percent} className="w-full h-1.5 accent-primary" />
    </div>}
    {error && <p role="alert" className="text-[12px] text-danger break-words">{error}</p>}
  </>
}
