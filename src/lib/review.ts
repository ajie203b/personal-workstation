import type { Annotation, ReviewState } from '@/db/db'
import { addDaysStr, todayStr } from './date'

/**
 * 高亮复习（v2.0）：把划过的批注当 Anki 卡片，按简化 SM-2 排期。
 * 只排文字高亮（截图批注不进队列）；没有 review 状态的旧高亮按「创建次日到期」处理，
 * 这样升级后历史高亮会自然进入队列，不用一次性迁移。
 */

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const MAX_EASE = 3.0
const MAX_INTERVAL = 365

export function dueOf(a: Pick<Annotation, 'review' | 'createdAt'>): string {
  if (a.review?.due) return a.review.due
  return addDaysStr(1, new Date(a.createdAt))
}

export function isDue(
  a: Pick<Annotation, 'review' | 'createdAt' | 'kind' | 'text'>,
  today = todayStr(),
): boolean {
  if (a.kind === 'shot') return false
  if (!a.text.trim()) return false
  return dueOf(a) <= today
}

/** 到期卡片：最早到期的在前；同一天按创建时间 */
export function dueCards(annotations: Annotation[], today = todayStr()): Annotation[] {
  return annotations
    .filter((a) => isDue(a, today))
    .sort((x, y) => dueOf(x).localeCompare(dueOf(y)) || x.createdAt - y.createdAt)
}

/**
 * 评分 → 下一次复习状态。
 * again 当天重来（由页面重新排队），hard/good/easy 按间隔倍数推进；
 * ease 只在 hard/again 下调、easy 上调，夹在 1.3–3.0。
 */
export function reviewNext(
  prev: ReviewState | undefined,
  rating: ReviewRating,
  today = todayStr(),
): ReviewState {
  const base: ReviewState = prev ?? { due: today, interval: 0, ease: DEFAULT_EASE, reps: 0 }
  let ease = base.ease || DEFAULT_EASE
  let interval = base.interval || 0
  let reps = base.reps || 0

  if (rating === 'again') {
    ease -= 0.2
    interval = 0
    reps = 0
  } else if (rating === 'hard') {
    ease -= 0.15
    interval = Math.max(1, Math.round(interval * 1.2))
    reps += 1
  } else if (rating === 'good') {
    interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * ease))
    reps += 1
  } else {
    ease += 0.15
    interval = reps === 0 ? 3 : Math.max(2, Math.round(interval * ease * 1.3))
    reps += 1
  }

  ease = Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(ease * 100) / 100))
  interval = Math.min(MAX_INTERVAL, Math.max(0, interval))

  return {
    due: rating === 'again' ? today : addDaysStr(interval),
    interval,
    ease,
    reps,
    lastAt: Date.now(),
  }
}

/** 给按钮显示「N 天后」文案 */
export function previewInterval(prev: ReviewState | undefined, rating: ReviewRating, today = todayStr()): string {
  const next = reviewNext(prev, rating, today)
  if (next.interval === 0) return '今天再来'
  return `${next.interval} 天后`
}
