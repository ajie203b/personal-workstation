import { pressureWidth } from './geometry'
import type { BlockResult, InkBlock, NoteGraph, Stroke } from './types'

/** 答案颜色：苹果数学笔记那种暖黄/橙，深浅色模式下都醒目 */
export const ANSWER_COLOR = '#F29D0B'
/** 手写风格字体：各平台自带的手写体，最后退到系统 cursive（安卓是 Dancing Script） */
export const HAND_FONT = '"Bradley Hand", "Segoe Print", "Chalkboard SE", "Comic Sans MS", "Kaiti SC", STKaiti, KaiTi, cursive'
export const PEN_WIDTH = 2.6
export const ERASER_RADIUS = 12
/** 停笔多久自动识别（毫秒） */
export const IDLE_MS = 1000
export const GRID = 28

/** 识别失败标记 / 「?」标记的宽度 */
export const MARK_WIDTH = 26
export const FAIL_MARK_WIDTH = 184

export type Tool = 'pen' | 'eraser' | 'lasso'
export type Action =
  | { type: 'add'; strokes: Stroke[] }
  | { type: 'erase'; strokes: Stroke[] }
  | { type: 'clear'; strokes: Stroke[]; graphs?: NoteGraph[] }
  | { type: 'graphs'; before: NoteGraph[]; after: NoteGraph[] }
  | { type: 'move'; before: Stroke[]; after: Stroke[] }
export type ModelState =
  | { phase: 'idle' }
  | { phase: 'loading'; ratio: number; file: string }
  | { phase: 'ready'; backend: string }
  | { phase: 'error'; message: string }

export interface OverlayItem {
  key: string
  block: InkBlock
  /** 识别结果；识别失败时为空，此时 failed 是失败原因 */
  res: BlockResult | null
  failed?: string
  x: number
  y: number
  fontSize: number
  placement: 'inline' | 'below'
  fontWeight?: number
  canCorrect?: boolean
  /** 答案比可视宽度还宽时限宽（答案自身横向滚动） */
  maxWidth?: number
}

export interface RecognizeJob {
  key: string
  pageId: string
  strokes: Stroke[]
  charHeight: number
}

export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** 画一笔：中点二次曲线平滑，线宽随压感逐段变化 */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, from = 0) {
  const pts = s.points
  if (!pts.length) return
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, pressureWidth(s.width, pts[0].p) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const prevMid = i >= 2 ? { x: (pts[i - 2].x + p0.x) / 2, y: (pts[i - 2].y + p0.y) / 2 } : p0
    const mid = i === pts.length - 1 ? p1 : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
    ctx.lineWidth = pressureWidth(s.width, (p0.p + p1.p) / 2)
    ctx.beginPath()
    ctx.moveTo(prevMid.x, prevMid.y)
    ctx.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y)
    ctx.stroke()
  }
}

/** LaTeX → 粗略的可见字符（估宽用） */
export function plainOf(latex: string): string {
  return latex.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\\]/g, '')
}
