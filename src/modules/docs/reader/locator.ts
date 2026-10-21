import type { Annotation, Doc, ReadingPosition } from '@/db/db'
import { db } from '@/db/db'
import { addBookmark } from '@/db/docs'

/**
 * 阅读器的定位串工具（p3 / b7 / f2）。
 *
 * 三种阅读器各用一套单位，定位串是它们与目录、批注、书签、深链之间唯一的公共语言：
 * pdf = 页（p）、md = 块（b）、epub/docx/pptx/txt = 章节/片（f）。
 * 这些函数原先散在 DocReaderPage 里，抽出来才能被 hook 与侧栏组件共用。
 */

export const FLOW_KINDS: readonly Doc['kind'][] = ['epub', 'docx', 'pptx', 'txt']

/** 页/块/章 在文案里的单位名 */
const FLOW_UNIT: Partial<Record<Doc['kind'], string>> = { epub: '章', pptx: '片', docx: '节', txt: '节' }

export function anchorOf(progress: NonNullable<ReadingPosition['progress']>): string {
  if (progress.kind === 'pdf') return `p${progress.page}`
  if (progress.kind === 'flow') return `f${progress.segIdx}`
  return `b${progress.blockIdx}`
}

/** 批注定位锚点：pdf=p 页码；md=b 块号；flow(epub/docx/pptx/txt)=f 章节号（blockIdx 存 segIdx） */
export function annotationAnchor(doc: Doc, a: Annotation): string {
  if (doc.kind === 'pdf') return `p${a.page}`
  if (FLOW_KINDS.includes(doc.kind)) return `f${a.blockIdx}`
  return `b${a.blockIdx}`
}

/** 阅读进度回调给的序号 → 定位串 */
export function locatorFor(kind: Doc['kind'] | undefined, index: number): string {
  if (kind === 'pdf') return `p${index}`
  if (kind === 'md') return `b${index}`
  return `f${index}`
}

/** 侧栏里的位置文案（PDF 第 N 页 / 流式第 N 章） */
export function hrefLabelOf(doc: Doc, index: number): string {
  if (doc.kind === 'pdf') return `第 ${index || 1} 页`
  if (doc.kind === 'md') return `第 ${index + 1} 段`
  return `第 ${index + 1} ${FLOW_UNIT[doc.kind] ?? '节'}`
}

export function highlightLocator(doc: Doc, a: Annotation): string {
  if (doc.kind === 'pdf') return `第 ${a.page ?? 1} 页`
  if (FLOW_KINDS.includes(doc.kind)) return `第 ${(a.blockIdx ?? 0) + 1} ${FLOW_UNIT[doc.kind] ?? '节'}`
  return ''
}

/** 折叠空白后从第一个句末标点截断，最长 48 字；pdf.js 字距排版的中文会带空格，这里一并收紧 */
export function firstSentence(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').replace(/([\u4e00-\u9fff]) (?=[\u4e00-\u9fff])/g, '$1').trim()
  if (!s) return ''
  const hit = s.match(/^.{2,48}?(?:[。！？；]|[.!?](?=\s|$))/)
  return hit ? hit[0].trim() : s.slice(0, 48)
}

/**
 * 书签摘录：取该位置的第一句话。
 * 先读已渲染的 DOM（书签总是加在当前看到的页/块上），PDF 页不在渲染窗口时退回全文索引的分页文本。
 */
export async function quoteAtLocator(doc: Doc, anchor: string): Promise<string | undefined> {
  const m = anchor.match(/^([pbf])(\d+)$/)
  if (!m) return undefined
  const idx = Number(m[2])
  let raw = ''
  if (m[1] === 'p') {
    raw = document.querySelector(`[data-page="${idx}"] .textLayer`)?.textContent ?? ''
    if (!raw.trim()) raw = (await db.docText.get(doc.hash))?.segments?.[idx - 1] ?? ''
  } else if (m[1] === 'b') {
    raw = document.getElementById(`b${idx}`)?.textContent ?? ''
  } else {
    raw = document.querySelector(`[data-seg="${idx}"]`)?.textContent ?? ''
  }
  return firstSentence(raw) || undefined
}

/** 在当前阅读位置加书签（单位名与摘录都按文档类型推导） */
export async function addBookmarkAt(doc: Doc, currentLocator: string): Promise<void> {
  const index = Number(currentLocator.slice(1) || '0')
  const unitLabel = hrefLabelOf(doc, index)
  const anchor = currentLocator || (doc.kind === 'pdf' ? 'p1' : doc.kind === 'md' ? 'b0' : 'f0')
  await addBookmark(doc.hash, unitLabel, anchor, await quoteAtLocator(doc, anchor))
}
