import type { Annotation, Doc } from '@/db/db'

export const FLOW_KINDS: readonly Doc['kind'][] = ['epub', 'docx', 'pptx', 'txt']

/** 阅读、批注与任务共用定位协议：PDF 页 p、Markdown 块 b、流式章节 f。 */
export function annotationAnchor(doc: Pick<Doc, 'kind'>, annotation: Pick<Annotation, 'page' | 'blockIdx'>): string {
  if (doc.kind === 'pdf') return `p${annotation.page ?? 1}`
  if (FLOW_KINDS.includes(doc.kind)) return `f${annotation.blockIdx ?? 0}`
  return `b${annotation.blockIdx ?? 0}`
}
