import type { Annotation, Doc } from '@/db/db'
import { db } from '@/db/db'
import { getDocBlob, importDoc } from '@/db/docs'
import { fmtDateTime } from '@/lib/date'
import { annotationAnchor } from '@/lib/docLocator'
import { saveBlob } from '@/lib/saveFile'
import { formatCitation } from './citation'

/**
 * 批注一键导出为笔记（v1.3 + Zotero P1 + Phase 4）：
 * - Markdown 导出附带 Obsidian / Readwise 兼容 YAML Frontmatter + 站内深链回跳
 * - PDF 带批注真导出：复用 pdf-lib 把高亮矩形与评论写入标准 PDF Annotation 层
 */

const COLOR_LABEL: Record<Annotation['color'], string> = {
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  red: '红',
}

const PDF_HL_RGB: Record<Annotation['color'], [number, number, number]> = {
  yellow: [1.0, 0.91, 0.32],
  green: [0.52, 0.90, 0.60],
  blue: [0.54, 0.79, 1.0],
  red: [1.0, 0.60, 0.60],
}

function locLabel(a: Annotation, kind: Doc['kind']): string {
  if (kind === 'pdf' && a.page) return `第 ${a.page} 页`
  if (kind === 'md' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 段`
  if (kind === 'epub' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 章`
  if (kind === 'pptx' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 片`
  if (kind === 'docx' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 节`
  if (kind === 'txt' && a.blockIdx != null) return `第 ${a.blockIdx + 1} 段`
  if (a.page) return `第 ${a.page} 页`
  return '定位原文'
}

function yamlStr(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, ' ').trim())
}

function buildYamlFrontmatter(doc: Doc, count: number, exportedAt: string): string[] {
  const lines: string[] = ['---', `title: ${yamlStr(doc.title)}`]
  if (doc.meta?.author?.trim()) lines.push(`author: ${yamlStr(doc.meta.author)}`)
  if (doc.meta?.year?.trim()) lines.push(`year: ${yamlStr(doc.meta.year)}`)
  if (doc.meta?.venue?.trim()) lines.push(`venue: ${yamlStr(doc.meta.venue)}`)
  if (doc.meta?.doi?.trim()) lines.push(`doi: ${yamlStr(doc.meta.doi)}`)
  if (doc.sourceUrl?.trim()) lines.push(`source: ${yamlStr(doc.sourceUrl)}`)
  if (doc.tags?.length) {
    lines.push('tags:')
    for (const tag of doc.tags) lines.push(`  - ${yamlStr(tag)}`)
  }
  lines.push(`annotations: ${count}`)
  lines.push(`exported_at: ${yamlStr(exportedAt)}`)
  lines.push('---', '')
  return lines
}

export async function buildAnnotationMarkdown(doc: Doc, annotations: Annotation[]): Promise<string> {
  const sorted = [...annotations].sort((a, b) => {
    const pa = a.page ?? a.blockIdx ?? 0
    const pb = b.page ?? b.blockIdx ?? 0
    if (pa !== pb) return pa - pb
    return a.createdAt - b.createdAt
  })

  const exportedAt = fmtDateTime(new Date())
  const lines: string[] = [
    ...buildYamlFrontmatter(doc, sorted.length, exportedAt),
    `# 《${doc.title}》批注笔记`,
    '',
    `> 共 ${sorted.length} 条批注 · 导出于 ${exportedAt} · Kairos`,
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
      if (a.text && a.text !== '区域截图') lines.push(`> ${a.text.replace(/\r?\n/g, '\n> ')}`)
    } else {
      lines.push(`- **[${COLOR_LABEL[a.color]}]** ${a.text.replace(/\r?\n/g, ' ')} · [${loc}](${deepLink})`)
    }
    if (a.comment) {
      const commentLines = a.comment.split(/\r?\n/)
      lines.push(`  - 评论：${commentLines[0]}`)
      for (const extra of commentLines.slice(1)) lines.push(`    ${extra}`)
    }
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

/**
 * 将 Kairos 的 PDF 高亮矩形与批注评论写入标准 PDF Annotation 层（/Subtype /Highlight + /QuadPoints + /Contents）。
 * 兼容 Adobe Acrobat、Chrome、Edge、macOS 预览与 WPS；中文评论通过 UTF-16BE PDFHexString 无损编码。
 */
export async function buildAnnotatedPdfBytes(
  pdfBytes: Uint8Array | ArrayBuffer,
  annotations: readonly Annotation[],
): Promise<Uint8Array> {
  const { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const pages = pdfDoc.getPages()

  for (const ann of annotations) {
    if (!ann.page || ann.page < 1 || ann.page > pages.length) continue
    const rects = ann.rects?.filter((r) => r.w > 0 && r.h > 0) ?? []
    if (rects.length === 0) continue

    const page = pages[ann.page - 1]
    const { width, height } = page.getSize()
    const quadNums: number[] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const r of rects) {
      const x1 = Math.max(0, Math.min(width, r.x * width))
      const x2 = Math.max(0, Math.min(width, (r.x + r.w) * width))
      const yTop = Math.max(0, Math.min(height, (1 - r.y) * height))
      const yBot = Math.max(0, Math.min(height, (1 - (r.y + r.h)) * height))
      const y1 = Math.min(yBot, yTop)
      const y2 = Math.max(yBot, yTop)
      if (x2 <= x1 || y2 <= y1) continue
      minX = Math.min(minX, x1)
      minY = Math.min(minY, y1)
      maxX = Math.max(maxX, x2)
      maxY = Math.max(maxY, y2)
      // PDF QuadPoints 顺序：左上、右上、左下、右下
      quadNums.push(x1, y2, x2, y2, x1, y1, x2, y1)
    }
    if (quadNums.length === 0) continue

    const rgb = PDF_HL_RGB[ann.color] ?? PDF_HL_RGB.yellow
    const contents = [ann.comment?.trim(), ann.text?.trim()].filter(Boolean).join('\n\n')
    const annotDict = pdfDoc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Highlight'),
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadNums,
      C: rgb,
      CA: PDFNumber.of(0.45),
      F: PDFNumber.of(4), // Print flag
      T: PDFHexString.fromText('Kairos'),
      ...(contents ? { Contents: PDFHexString.fromText(contents) } : {}),
    })
    const annotRef = pdfDoc.context.register(annotDict)

    const existing = page.node.lookup(PDFName.of('Annots'))
    if (existing instanceof PDFArray) {
      existing.push(annotRef)
    } else {
      page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([annotRef]))
    }
  }

  return pdfDoc.save()
}

/** 导出带原生 PDF 高亮与评论注解层的 .pdf 文件 */
export async function exportAnnotatedPdf(doc: Doc): Promise<string> {
  if (doc.kind !== 'pdf') throw new Error('仅 PDF 文档支持导出带批注 PDF')
  const [blob, annotations] = await Promise.all([
    getDocBlob(doc.hash),
    db.annotations.where('docHash').equals(doc.hash).toArray(),
  ])
  if (!blob) throw new Error('PDF 原文件缺失，无法导出')
  const outBytes = await buildAnnotatedPdfBytes(await blob.arrayBuffer(), annotations)
  const copy = new Uint8Array(outBytes.byteLength)
  copy.set(outBytes)
  const safe = doc.title.replace(/[<>:"/\\|?*]/g, ' ').trim().slice(0, 50) || '文档'
  return saveBlob(new Blob([copy], { type: 'application/pdf' }), `${safe}-已批注.pdf`)
}
