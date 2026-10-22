import type { Annotation, AnnotationTextAnchor, Doc } from '@/db/db'

/** 划词选区：三种阅读器各自的定位信息 */
export type Selection =
  | { kind: 'md'; text: string; blockIdx: number; textAnchors?: AnnotationTextAnchor[]; popover: { left: number; y: number; below: boolean } }
  | { kind: 'pdf'; text: string; page: number; rects: { x: number; y: number; w: number; h: number }[]; popover: { left: number; y: number; below: boolean } }
  | { kind: 'flow'; text: string; segIdx: number; textAnchors?: AnnotationTextAnchor[]; popover: { left: number; y: number; below: boolean } }

/** 高亮四色：浮条、侧栏改色、阅读器包裹标记共用同一份顺序 */
export const HL_COLORS = ['yellow', 'green', 'blue', 'red'] as const

export type HlColor = (typeof HL_COLORS)[number]

/** 批注条目左侧色条 / 浮条色点 */
export function annotationColorClass(a: Annotation): string {
  if (a.kind === 'shot') return 'bg-primary'
  return a.color === 'yellow' ? 'bg-yellow-400' : a.color === 'green' ? 'bg-green-400' : a.color === 'blue' ? 'bg-blue-400' : 'bg-red-400'
}

export interface AnnotationTaskSeed {
  ann: Annotation
  doc: Doc
}
