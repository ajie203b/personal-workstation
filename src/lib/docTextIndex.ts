import type { Doc, DocKind } from '@/db/db'
import { db } from '@/db/db'

/**
 * 文档全文索引（v1.3）：导入时抽取纯文本存 docText 表，
 * DocsPage 搜索按 标题 + 内容 命中，PDF/EPUB/PPTX 保留分段用于定位。
 */

/** 按扩展名/类型判 kind（与 importDoc 一致） */
export function detectKind(name: string): DocKind {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf')) return 'pdf'
  if (n.endsWith('.epub')) return 'epub'
  if (n.endsWith('.docx')) return 'docx'
  if (n.endsWith('.pptx')) return 'pptx'
  if (n.endsWith('.txt') || n.endsWith('.markdown')) return n.endsWith('.markdown') ? 'md' : 'txt'
  return 'md'
}

/** 抽取纯文本；segments 按页/章/片分段（与 kind 对应） */
export async function extractDocText(kind: DocKind, blob: Blob): Promise<{ text: string; segments?: string[]; segmentUnit?: 'page' | 'chapter' | 'slide' }> {
  if (kind === 'pdf') return extractPdf(blob)
  if (kind === 'epub') return extractEpub(blob)
  if (kind === 'docx') return extractDocx(blob)
  if (kind === 'pptx') return extractPptx(blob)
  const text = await blob.text()
  return { text }
}

/* ---- PDF：pdf.js 按页 getTextContent ---- */
async function extractPdf(blob: Blob): Promise<{ text: string; segments: string[]; segmentUnit: 'page' }> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
  const segments: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    segments.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  await pdf.destroy()
  return { text: segments.join('\n'), segments, segmentUnit: 'page' }
}

/* ---- EPUB：JSZip 按 spine 顺序解析章节 xhtml ---- */
async function extractEpub(blob: Blob): Promise<{ text: string; segments: string[]; segmentUnit: 'chapter' }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const container = await zip.file('META-INF/container.xml')?.async('string')
  let opfPath = ''
  if (container) {
    const m = container.match(/full-path="([^"]+)"/)
    if (m) opfPath = m[1]
  }
  let chapters: string[] = []
  if (opfPath && zip.file(opfPath)) {
    const opf = await zip.file(opfPath)!.async('string')
    const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    const manifest = new Map<string, string>()
    for (const m of opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"[^>]*>/g)) manifest.set(m[1], m[2])
    for (const m of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"[^>]*\/?>/g)) {
      const href = manifest.get(m[1])
      if (href) chapters.push(baseDir + href.replace(/^\.\//, ''))
    }
  }
  if (!chapters.length) {
    // 兜底：所有 html/xhtml 文件按名排序
    chapters = Object.keys(zip.files).filter((p) => /\.x?html?$/i.test(p)).sort()
  }
  const segments: string[] = []
  for (const path of chapters) {
    const file = zip.file(path) ?? zip.file(decodeURIComponent(path))
    if (!file) continue
    const html = await file.async('string')
    segments.push(htmlToText(html))
  }
  return { text: segments.join('\n'), segments, segmentUnit: 'chapter' }
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,head').forEach((el) => el.remove())
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/* ---- DOCX：mammoth 抽纯文本 ---- */
async function extractDocx(blob: Blob): Promise<{ text: string }> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })
  return { text: result.value }
}

/* ---- PPTX：JSZip 读 slide XML 的 a:t 文本 ---- */
async function extractPptx(blob: Blob): Promise<{ text: string; segments: string[]; segmentUnit: 'slide' }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)![1])
      const nb = Number(b.match(/slide(\d+)\.xml/)![1])
      return na - nb
    })
  const segments: string[] = []
  for (const p of slidePaths) {
    const xml = await zip.file(p)!.async('string')
    const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1])
    segments.push(texts.join(' ').replace(/\s+/g, ' ').trim())
  }
  return { text: segments.join('\n'), segments, segmentUnit: 'slide' }
}

/* ---- 落库 ---- */

export async function indexDoc(doc: Doc, blob: Blob): Promise<void> {
  try {
    const { text, segments, segmentUnit } = await extractDocText(doc.kind, blob)
    await db.docText.put({ hash: doc.hash, kind: doc.kind, text, segments, segmentUnit, indexedAt: Date.now() })
  } catch {
    // 抽取失败不阻塞导入；下次打开搜索时回填重试
  }
}

/** 为没有索引的文档建索引（搜索前批量回填，单次最多 limit 篇防卡顿） */
export async function backfillDocTextIndex(limit = 5): Promise<number> {
  const docs = await db.docs.toArray()
  let done = 0
  for (const doc of docs) {
    const has = await db.docText.get(doc.hash)
    if (has) continue
    const row = await db.blobs.get(doc.hash)
    if (!row?.blob) continue
    await indexDoc(doc, row.blob)
    done++
    if (done >= limit) break
  }
  return done
}
