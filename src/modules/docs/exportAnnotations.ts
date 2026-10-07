import type { Annotation, Doc } from '@/db/db'
import { db } from '@/db/db'
import { importDoc } from '@/db/docs'

/**
 * 批注一键导出为笔记（v1.3）：全部高亮/截图 + 评论 → 一篇 Markdown 文档收进文档库。
 * 截图批注以 dataURL 内嵌，其余按颜色与位置整理。
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
  if (a.page) return `第 ${a.page} 页`
  return ''
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
    `> 共 ${sorted.length} 条批注 · 导出于 ${new Date().toLocaleString('zh-CN')} · 个人工作站`,
    '',
  ]

  let lastLoc = ''
  for (const a of sorted) {
    const loc = locLabel(a, doc.kind)
    if (loc && loc !== lastLoc) {
      lines.push(`## ${loc}`, '')
      lastLoc = loc
    }
    if (a.kind === 'shot' && a.img) {
      lines.push(`![区域截图](${a.img})`)
      if (a.text && a.text !== '区域截图') lines.push('', `> ${a.text}`)
    } else {
      lines.push(`- **[${COLOR_LABEL[a.color]}]** ${a.text}`)
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
