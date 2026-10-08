/**
 * 三模块互跳统一入口（方案 4.4）：模块间零直接 import，
 * 全部走声明式深链 —— 路由参数承载定位上下文，可分享、可回退。
 */
import type { Doc, DocRef, DocKind } from '@/db/db'

function go(path: string) {
  window.location.hash = `#${path}`
}

/**
 * 全文命中分段序号（索引 segments 的 1 基下标）→ 阅读器锚点。
 * 仅 PDF 能对应（索引按页分段，页码 1 基）。
 * EPUB/PPTX 的索引按章/片分段，但阅读器的段下标会跳过空段与解析失败项，
 * 两套序号整体错位；MD/DOCX/TXT 的索引不分段。故除 PDF 外一律不传锚点，
 * 宁可「只打开文档」也不要跳到错误位置。
 */
export function segAnchor(kind: DocKind, seg?: number): string | null {
  if (!seg) return null
  return kind === 'pdf' ? `p${seg}` : null
}

/** 任务 → 文档工作站：定位到页码/块锚点并闪烁批注 */
export function openDoc(ref: DocRef, hl?: string): void {
  const params = new URLSearchParams()
  if (ref.anchor) params.set('p', ref.anchor)
  const flashId = hl ?? (ref.anchor?.includes('#') ? ref.anchor.split('#')[1] : undefined)
  if (flashId) params.set('hl', flashId)
  go(`/docs/${encodeURIComponent(ref.docId)}${params.size ? `?${params}` : ''}`)
}

/** 文档库/⌘K 的全文命中 → 打开阅读并定位到命中分段 */
export function openDocAtHit(doc: Pick<Doc, 'id' | 'kind'>, seg?: number): void {
  openDoc({ docId: doc.id, anchor: segAnchor(doc.kind, seg) ?? undefined })
}

/** 文档批注 → 任务清单：预填标题 + 挂载 docRef */
export function openTaskWithRef(ref: DocRef): void {
  const params = new URLSearchParams()
  params.set('presetDoc', JSON.stringify(ref))
  go(`/tasks?${params}`)
}
