import type { Annotation, Doc } from '@/db/db'

/** 划词选区：三种阅读器各自的定位信息 */
export type Selection =
  | { kind: 'md'; text: string; blockIdx: number; popover: { left: number; y: number; below: boolean } }
  | { kind: 'pdf'; text: string; page: number; rects: { x: number; y: number; w: number; h: number }[]; popover: { left: number; y: number; below: boolean } }
  | { kind: 'flow'; text: string; segIdx: number; popover: { left: number; y: number; below: boolean } }

/** 高亮四色：浮条、侧栏改色、阅读器包裹标记共用同一份顺序 */
export const HL_COLORS = ['yellow', 'green', 'blue', 'red'] as const

export type HlColor = (typeof HL_COLORS)[number]

/** 批注条目左侧色条 / 浮条色点 */
export function annotationColorClass(a: Annotation): string {
  if (a.kind === 'shot') return 'bg-primary'
  return a.color === 'yellow' ? 'bg-yellow-400' : a.color === 'green' ? 'bg-green-400' : a.color === 'blue' ? 'bg-blue-400' : 'bg-red-400'
}

/** 批注 → 任务时的定位串（pdf=p 页码；其余=b/f + 序号），同时用于深链 */
export function taskAnchorOf(a: Annotation): string {
  return a.page != null ? `p${a.page}` : `b${a.blockIdx ?? 0}`
}

export interface AnnotationTaskSeed {
  ann: Annotation
  doc: Doc
}
