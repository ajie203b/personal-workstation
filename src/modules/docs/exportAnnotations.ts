import type { Annotation, Doc } from '@/db/db'
import { db } from '@/db/db'
import { importDoc } from '@/db/docs'
import { fmtDateTime } from '@/lib/date'
import { annotationAnchor } from '@/lib/docLocator'
import { saveBlob } from '@/lib/saveFile'
import { formatCitation } from './citation'

/**
 * 批注一键导出为笔记（v1.3 + Zotero P1）：
 * 全部高亮/截图 + 评论 + 站内深链回跳 → Markdown 文档收进文档库或直接导出为 .md 文件。
 */

const COLOR_LABEL: Record<Annotation['color'], string> = {
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  red: '红',
}

function locLabel(a: Annotation, kind: Doc['kind']): string {
  if (kind === 'pdf' && a.page) return `第 ${a.page} 页`
  if (kind === 'md' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 段`
  if (kind === 'epub' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 章`
  if (kind === 'pptx' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 片`
  if (a.page) return `第 ${a.page} 页`
  return '定位原文'
}

export async function buildAnnotationMarkdown(doc: Doc, annotations: Annotation[]): Promise<string> {
  const sorted = [...annotations].sort((a, b) => {
    const pa = a.page ?? a.blockIdx ?? 0
    const pb = b.page ?? b.blockIdx ?? 0
    if (pa !== pb) return pa - pb
    return a.createdAt - b.createdAt
  })

  const lines: string[] = [
    `# 《${doc.title}》批注笔记`,
    '',
    `> 共 ${sorted.length} 条批注 · 导出于 ${fmtDateTime(new Date())} · Kairos`,
  ]
  if (doc.meta && Object.values(doc.meta).some(Boolean)) {
    lines.push(`> 来源引用：${formatCitation(doc, 'markdown')}`)
  }
  lines.push('')

  let lastLoc = ''
  for (const a of sorted) {
    const loc = locLabel(a, doc.kind)
    const deepLink = `#/docs/${doc.id}?p=${encodeURIComponent(annotationAnchor(doc, a))}&hl=${encodeURIComponent(a.id)}`
    if (loc && loc !== '定位原文' && loc !== lastLoc) {
      lines.push(`## ${loc}`, '')
      lastLoc = loc
    }
    if (a.kind === 'shot' && a.img) {
      lines.push(`![区域截图](${a.img})`, '', `> [跳转${loc}](${deepLink})`)
      if (a.text && a.text !== '区域截图') lines.push(`> ${a.text}`)
    } else {
      lines.push(`- **[${COLOR_LABEL[a.color]}]** ${a.text} · [${loc}](${deepLink})`)
    }
    if (a.comment) lines.push(`  - 评论：${a.comment}`)
    if (lines[lines.length - 1] !== '') lines.push('')
  }

  return lines.join('\n')
}

/** 生成批注笔记并作为 MD 文档收进工作站，返回新文档 id */
export async function exportAnnotationsToDoc(doc: Doc): Promise<string> {
  const annotations = await db.annotations.where('docHash').equals(doc.hash).toArray()
  const md = await buildAnnotationMarkdown(doc, annotations)
  const file = new File([md], `《${doc.title}》批注笔记.md`, { type: 'text/markdown' })
  const r = await importDoc(file)
  return r.doc.id
}

/** 将当前文档批注下载/保存到本地 .md 文件 */
export async function exportAnnotationsToMarkdownFile(doc: Doc): Promise<string> {
  const annotations = await db.annotations.where('docHash').equals(doc.hash).toArray()
  const md = await buildAnnotationMarkdown(doc, annotations)
  const safe = doc.title.replace(/[<>:"/\\|?*]/g, ' ').trim().slice(0, 50) || '批注笔记'
  return saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${safe}-批注.md`)
}
