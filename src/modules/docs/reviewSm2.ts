import type { Annotation, ReviewState } from '@/db/db'

export type ReviewRating = 0 | 1 | 2 | 3

function todayStr(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days)
  return todayStr(dt)
}

export function isAnnotationDue(ann: Annotation, today = todayStr()): boolean {
  if (ann.review?.due) return ann.review.due <= today
  return true
}

/**
 * 轻量 SM-2 调度（复用 db.ts 中的 Annotation.review）：
 * 0=忘记(重来) / 1=模糊 / 2=记得 / 3=轻松
 */
export function scheduleReview(prev: ReviewState | undefined, rating: ReviewRating, today = todayStr(), now = Date.now()): ReviewState {
  const prevEase = prev?.ease ?? 2.5
  const prevReps = prev?.reps ?? 0
  const prevInterval = prev?.interval ?? 0

  let reps: number
  let interval: number
  if (rating === 0) {
    reps = 0
    interval = 1
  } else if (rating === 1) {
    reps = Math.max(1, prevReps)
    interval = prevInterval <= 1 ? 1 : Math.max(2, Math.round(prevInterval * 0.6))
  } else {
    reps = prevReps + 1
    if (reps === 1) interval = rating === 3 ? 4 : 1
    else if (reps === 2) interval = rating === 3 ? 6 : 3
    else interval = Math.max(1, Math.round(prevInterval * prevEase * (rating === 3 ? 1.3 : 1)))
  }

  const quality = rating === 0 ? 1 : rating === 1 ? 3 : rating === 2 ? 4 : 5
  const nextEase = Math.max(1.3, Number((prevEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))).toFixed(2)))

  return {
    due: addDays(today, interval),
    interval,
    ease: nextEase,
    reps,
    lastAt: now,
  }
}
