import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RotateCcw, Sparkles } from 'lucide-react'
import { DOC_KIND_LABEL, type Annotation, type Doc } from '@/db/db'
import { updateAnnotation } from '@/db/docs'
import { annotationAnchor } from '@/lib/docLocator'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { cn } from '@/lib/cn'
import { hrefLabelOf } from './reader/locator'
import { isAnnotationDue, scheduleReview, type ReviewRating } from './reviewSm2'

const RATINGS: { rating: ReviewRating; label: string; hint: string; tone: string }[] = [
  { rating: 0, label: '重来', hint: '1天', tone: 'text-danger border-danger/30 hover:bg-danger/10' },
  { rating: 1, label: '模糊', hint: '短期', tone: 'text-p1 border-p1/30 hover:bg-p1/10' },
  { rating: 2, label: '记得', hint: '标准', tone: 'text-primary border-primary/30 hover:bg-primary-soft' },
  { rating: 3, label: '轻松', hint: '延后', tone: 'text-ok border-ok/30 hover:bg-ok/10' },
]

export function AnnotationReviewDialog({
  open,
  onOpenChange,
  docs,
  annotations,
  onJump,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  docs: readonly Doc[]
  annotations: readonly Annotation[]
  onJump?: (docId: string, anchor: string, hlId: string) => void
}) {
  const [scopeAll, setScopeAll] = useState(false)
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [doneCount, setDoneCount] = useState(0)

  const docByHash = useMemo(() => new Map(docs.map((d) => [d.hash, d])), [docs])

  const queue = useMemo(() => {
    const valid = annotations.filter((a) => docByHash.has(a.docHash) && (a.text.trim() || a.img))
    const list = scopeAll ? valid : valid.filter((a) => isAnnotationDue(a))
    return [...list].sort((a, b) => (a.review?.due ?? '').localeCompare(b.review?.due ?? '') || a.createdAt - b.createdAt)
  }, [annotations, docByHash, scopeAll])

  useEffect(() => {
    if (open) {
      setIdx(0)
      setRevealed(false)
      setDoneCount(0)
    }
  }, [open, scopeAll])

  const cur = queue[idx]
  const curDoc = cur ? docByHash.get(cur.docHash) : undefined
  const position = curDoc?.kind === 'pdf' ? cur?.page : cur?.blockIdx
  const isScreenshot = !!cur?.img
  // PDF 选区偶尔会把排版间距复制成多行空白。只整理展示文本，保留公式换行。
  const excerpt = curDoc?.kind === 'pdf'
    ? cur?.text.replace(/\r\n?/g, '\n').replace(/\n(?:[^\S\n]*\n){2,}/g, '\n\n').trim()
    : cur?.text

  const rate = async (rating: ReviewRating) => {
    if (!cur) return
    const nextReview = scheduleReview(cur.review, rating)
    await updateAnnotation(cur.id, { review: nextReview })
    setDoneCount((n) => n + 1)
    setRevealed(false)
    if (scopeAll) setIdx((i) => i + 1)
    else setIdx((i) => Math.min(i, Math.max(0, queue.length - 2)))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="批注间隔重复复习"
      widthClass="w-[min(640px,94vw)]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-[12px] text-on-surface-2">
          <span className="tabular-nums">
            {queue.length > 0 && idx < queue.length
              ? `当前第 ${idx + 1} / ${queue.length} 条 · 本轮已复习 ${doneCount} 条`
              : `本轮已完成 ${doneCount} 条`}
          </span>
          <button
            type="button"
            onClick={() => setScopeAll((v) => !v)}
            className="text-primary hover:underline cursor-pointer"
          >
            {scopeAll ? '仅看今天到期' : '查看全部批注'}
          </button>
        </div>

        {!cur || idx >= queue.length ? (
          <div className="py-8 text-center rounded-[12px] bg-surface-2 border border-outline/70 px-4">
            <Sparkles size={22} className="mx-auto text-primary mb-2" />
            <p className="text-[14px] font-medium">
              {scopeAll ? '已经刷完全部批注' : '今天到期的批注已全部复习完毕'}
            </p>
            <p className="text-[12px] text-on-surface-2 mt-1">
              阅读时划词高亮会自动纳入后续间隔复习计划。
            </p>
            {!scopeAll && annotations.some((a) => docByHash.has(a.docHash)) && (
              <Button size="sm" className="mt-3" onClick={() => setScopeAll(true)}>
                <RotateCcw size={13} /> 浏览全部批注
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-[12px] border border-outline overflow-hidden">
            <div className="border-b border-outline/70 bg-surface-2 px-4 py-3">
              <p className="text-xs text-on-surface-2">
                {curDoc && DOC_KIND_LABEL[curDoc.kind]}
                {curDoc && position != null && <> · {hrefLabelOf(curDoc, position)}</>}
              </p>
              <p title={curDoc?.title} className="mt-1 line-clamp-2 [overflow-wrap:anywhere] text-sm font-semibold">{curDoc?.title}</p>
            </div>

            <div key={cur.id} role="region" aria-label="批注内容" tabIndex={0} className="max-h-[48dvh] overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              {isScreenshot && (
                <img src={cur.img} alt="批注截图" className="mx-auto max-w-full rounded-lg border border-outline/70" />
              )}
              {excerpt && !(isScreenshot && excerpt === '区域截图') && (
                <blockquote className="border-l-2 border-primary/50 pl-3 text-[16px] leading-[1.8] whitespace-pre-wrap [overflow-wrap:anywhere]">{excerpt}</blockquote>
              )}
              {cur.comment && (
                revealed ? (
                  <div className="rounded-lg bg-surface-2 px-3 py-2.5">
                    <p className="mb-1 text-xs font-medium text-on-surface-2">我的评论</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{cur.comment}</p>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setRevealed(true)}>
                    显示我的评论笔记
                  </Button>
                )
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t border-outline/70">
              {curDoc && onJump && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false)
                    onJump(curDoc.id, annotationAnchor(curDoc, cur), cur.id)
                  }}
                  className="inline-flex items-center gap-1 text-[12px] text-on-surface-2 hover:text-primary cursor-pointer"
                >
                  <ExternalLink size={12} /> 定位原文
                </button>
              )}
              <div className="grid grid-cols-4 gap-1.5 w-full sm:ml-auto sm:w-auto">
                {RATINGS.map((r) => (
                  <button
                    key={r.rating}
                    type="button"
                    onClick={() => void rate(r.rating)}
                    className={cn(
                      'px-2.5 py-1.5 rounded-[8px] border text-[12px] font-medium transition-colors cursor-pointer',
                      r.tone,
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
