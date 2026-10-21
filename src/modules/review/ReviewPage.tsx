import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { BookOpen, Sparkles } from 'lucide-react'
import type { Annotation } from '@/db/db'
import { useAllAnnotations, useDocs } from '@/db/hooks'
import { updateAnnotation } from '@/db/docs'
import { dueCards, previewInterval, reviewNext, type ReviewRating } from '@/lib/review'
import { todayStr } from '@/lib/date'
import { cn } from '@/lib/cn'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'

const RATINGS: { key: ReviewRating; label: string; cls: string }[] = [
  { key: 'again', label: '忘了', cls: 'border-danger/40 text-danger hover:bg-danger/10' },
  { key: 'hard', label: '困难', cls: 'border-[color:var(--p1)]/40 text-[color:var(--p1)] hover:bg-[color:var(--p1)]/10' },
  { key: 'good', label: '一般', cls: 'border-ok/40 text-ok hover:bg-ok/10' },
  { key: 'easy', label: '简单', cls: 'border-primary/40 text-primary hover:bg-primary/10' },
]

/** 高亮复习：到期卡片逐张过，评分后按简化 SM-2 排下一次 */
export function ReviewPage() {
  const navigate = useNavigate()
  const all = useAllAnnotations()
  const docs = useDocs()
  const today = todayStr()

  const [queue, setQueue] = useState<Annotation[]>([])
  const [totalDue, setTotalDue] = useState(0)
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [rated, setRated] = useState(0)
  const inited = useRef(false)

  // 只在首次拿到数据时建队列：评分会触发 liveQuery，但队列不能被重置
  useEffect(() => {
    if (inited.current || all.length === 0) return
    inited.current = true
    const due = dueCards(all, today)
    setTotalDue(due.length)
    // 一轮最多 20 张：历史高亮可能一次到期几百张，排太多只会让人直接关掉
    setQueue(due.slice(0, 20))
  }, [all, today])

  const card = queue[idx]
  const doc = card ? docs.find((d) => d.hash === card.docHash) : undefined
  const remaining = Math.max(0, queue.length - idx)

  const rate = async (rating: ReviewRating) => {
    if (!card) return
    const next = reviewNext(card.review, rating, today)
    setRated((n) => n + 1)
    setRevealed(false)
    setQueue((q) => (rating === 'again' ? [...q, { ...card, review: next }] : q))
    setIdx((i) => i + 1)
    await updateAnnotation(card.id, { review: next })
  }

  // 空格翻面，1–4 评分
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return
      if (e.code === 'Space' && !revealed) {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (!revealed) return
      const hit = ['1', '2', '3', '4'].indexOf(e.key)
      if (hit >= 0) void rate(RATINGS[hit].key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openSource = () => {
    if (!card || !doc) return
    const anchor = card.page != null ? `p${card.page}` : `b${card.blockIdx ?? 0}`
    navigate(`/docs/${doc.id}?p=${anchor}&hl=${card.id}`)
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="glass relative z-30 shrink-0 flex items-center gap-2 h-14 px-3 md:px-4 border-b border-outline/70">
        <BackButton label="返回今日" onClick={() => navigate('/today')} className="w-10 h-10" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight">高亮复习</p>
          <p className="text-[11px] text-on-surface-2 leading-tight">
            {remaining > 0 ? `还剩 ${remaining} 张` : '今天没有到期卡片'}
            {rated > 0 && ` · 已过 ${rated} 张`}
          </p>
        </div>
        {doc && card && (
          <Button variant="ghost" size="sm" onClick={openSource}>
            <BookOpen size={15} /> 原文
          </Button>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!card ? (
          <div className="h-full grid place-items-center px-6">
            <EmptyState
              className="max-w-sm"
              icon={Sparkles}
              title={rated > 0 ? '这一轮过完了' : '今天没有需要复习的高亮'}
              hint={rated > 0
                ? `一共过了 ${rated} 张，评过的卡片按间隔再回来。${totalDue > 20 ? `今天还有 ${totalDue - 20} 张到期，明天继续。` : ''}`
                : '在文档里划词高亮后，第二天起会进入复习队列；评论和原文都会一起带回来。'}
            >
              <Button variant="primary" size="sm" onClick={() => navigate('/today')}>回到今日</Button>
            </EmptyState>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl px-4 md:px-8 py-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[12px] text-on-surface-2">
              <span className="truncate">{doc?.title ?? '文档'}</span>
              <span className="text-outline">·</span>
              <span className="shrink-0">
                {card.page != null ? `第 ${card.page} 页` : `第 ${(card.blockIdx ?? 0) + 1} 段`}
              </span>
            </div>

            <div className="card p-5 min-h-[220px] flex flex-col">
              <p className="text-[16px] leading-relaxed whitespace-pre-wrap text-on-surface">
                “{card.text}”
              </p>
              {revealed && (
                <div className="mt-4 pt-4 border-t border-outline/60 flex flex-col gap-2">
                  <p className="text-[12px] text-on-surface-2">你的评论</p>
                  <p className="text-[14px] leading-relaxed text-on-surface-2">
                    {card.comment?.trim() || '（这条高亮没有写评论）'}
                  </p>
                </div>
              )}
            </div>

            {!revealed ? (
              <Button variant="primary" className="w-full h-11 rounded-[12px] text-[14px]" onClick={() => setRevealed(true)}>
                显示答案 <span className="opacity-70 text-[12px] ml-1">空格</span>
              </Button>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {RATINGS.map((r, i) => (
                  <button
                    key={r.key}
                    onClick={() => void rate(r.key)}
                    className={cn('h-12 rounded-[12px] border bg-surface text-[13px] font-medium transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5', r.cls)}
                  >
                    <span>{r.label}</span>
                    <span className="text-[10.5px] opacity-70">{previewInterval(card.review, r.key, today)}</span>
                    <span className="sr-only">{i + 1}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11.5px] text-on-surface-2 text-center">
              评完之后按间隔重复再推回来；「忘了」会在这一轮末尾再出现一次
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
