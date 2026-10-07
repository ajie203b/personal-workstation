import type { DocKind } from '@/db/db'

/**
 * 流式文档解析（v1.3）：EPUB / DOCX / PPTX / TXT → 统一段落模型，
 * 供 FlowReader 渲染与全文索引共用。段落 = 章（epub）/ 片（pptx）/ 篇（docx/txt）。
 */

export interface FlowSegment {
  /** 章节标题（目录用），可缺省 */
  title?: string
  /** 已消毒的 HTML 片段（渲染用） */
  html: string
  /** 纯文本（搜索索引用） */
  text: string
}

export interface FlowDoc {
  unit: 'chapter' | 'slide' | 'doc'
  segments: FlowSegment[]
  /** 全文纯文本（= segments.text 拼接） */
  text: string
  /** 释放解析过程创建的 blob URL（文档关闭时调用，防内存泄漏） */
  dispose?: () => void
}

function htmlBody(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,link,meta,head').forEach((el) => el.remove())
  return doc.body?.innerHTML ?? ''
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,head').forEach((el) => el.remove())
  return (doc.body?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\s?\n\s?/g, '\n').trim()
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 解析为流式文档；pdf/md 走各自专用阅读器，不在此处理 */
export async function parseFlowDoc(kind: DocKind, blob: Blob): Promise<FlowDoc> {
  switch (kind) {
    case 'epub': return parseEpub(blob)
    case 'docx': return parseDocx(blob)
    case 'pptx': return parsePptx(blob)
    case 'txt': return parseTxt(blob)
    default: throw new Error(`unsupported flow kind: ${kind}`)
  }
}

/* ---- EPUB：JSZip 按 spine 解析章节（含图片内嵌为 blob URL） ---- */

/** 以 zip 根为基准解析相对路径，并在 zip 内做大小写/URL 编码容错匹配 */
function resolveZipPath(baseDir: string, src: string): string {
  const clean = src.split('#')[0].split('?')[0]
  const parts = (baseDir + clean).split('/')
  const stack: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return stack.join('/')
}

function findZipEntry(zip: { files: Record<string, unknown> }, path: string): string | null {
  if (zip.files[path]) return path
  const decoded = decodeURIComponent(path)
  if (zip.files[decoded]) return decoded
  const lower = decoded.toLowerCase()
  const hit = Object.keys(zip.files).find((k) => k.toLowerCase() === lower)
  return hit ?? null
}

type Zip = Awaited<ReturnType<typeof import('jszip')['loadAsync']>>

/** 把章 HTML 中的 img/image 引用替换为 blob URL（懒抽取图片资源） */
async function inlineEpubImages(html: string, chapterPath: string, zip: Zip, urls: string[]): Promise<string> {
  const baseDir = chapterPath.includes('/') ? chapterPath.slice(0, chapterPath.lastIndexOf('/') + 1) : ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imgs = doc.querySelectorAll('img[src], image[href]')
  for (const el of Array.from(imgs)) {
    const attr = el.tagName === 'IMG' ? 'src' : 'href'
    const src = el.getAttribute(attr)
    if (!src || /^(data:|https?:)/i.test(src)) continue
    const path = findZipEntry(zip, resolveZipPath(baseDir, src))
    if (!path) {
      el.remove()
      continue
    }
    try {
      const file = zip.file(path)!
      const mime = /\.png$/i.test(path) ? 'image/png' : /\.gif$/i.test(path) ? 'image/gif' : /\.svg$/i.test(path) ? 'image/svg+xml' : 'image/jpeg'
      const blob = new Blob([await file.async('arraybuffer')], { type: mime })
      const url = URL.createObjectURL(blob)
      urls.push(url)
      el.setAttribute(attr, url)
    } catch {
      el.remove()
    }
  }
  return doc.body?.innerHTML ?? ''
}

async function parseEpub(blob: Blob): Promise<FlowDoc> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const urls: string[] = []

  const container = await zip.file('META-INF/container.xml')?.async('string')
  let opfPath = ''
  if (container) {
    const m = container.match(/full-path="([^"]+)"/)
    if (m) opfPath = m[1]
  }

  let chapterPaths: string[] = []
  if (opfPath && zip.file(opfPath)) {
    const opf = await zip.file(opfPath)!.async('string')
    const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    const manifest = new Map<string, string>()
    for (const m of opf.matchAll(/<item\b[^>]*?\bid="([^"]+)"[^>]*?\bhref="([^"]+)"[^>]*?\/?>/g)) manifest.set(m[1], m[2])
    for (const m of opf.matchAll(/<itemref\b[^>]*?\bidref="([^"]+)"[^>]*?\/?>/g)) {
      const href = manifest.get(m[1])
      if (href) chapterPaths.push(baseDir + href.replace(/^\.\//, ''))
    }
  }
  if (!chapterPaths.length) {
    chapterPaths = Object.keys(zip.files).filter((p) => /\.x?html?$/i.test(p)).sort()
  }

  const segments: FlowSegment[] = []
  for (const path of chapterPaths) {
    const entry = findZipEntry(zip, path) ?? findZipEntry(zip, decodeURIComponent(path))
    if (!entry) continue
    const raw = await zip.file(entry)!.async('string')
    const text = htmlToText(raw)
    if (!text) continue
    // 图片 → blob URL 内嵌
    const html = await inlineEpubImages(raw, entry, zip, urls)
    // 章节标题：第一个 h1-h3，退化为序号
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    const h = doc.querySelector('h1,h2,h3')
    const title = h?.textContent?.trim() || `第 ${segments.length + 1} 章`
    segments.push({ title, html, text })
  }
  if (!segments.length) throw new Error('EPUB 解析为空')
  return {
    unit: 'chapter',
    segments,
    text: segments.map((s) => s.text).join('\n'),
    dispose: () => { for (const u of urls) { try { URL.revokeObjectURL(u) } catch { /* ignore */ } } },
  }
}

/* ---- DOCX：mammoth 转 HTML ---- */
async function parseDocx(blob: Blob): Promise<FlowDoc> {
  const mammoth = await import('mammoth')
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
  const text = htmlToText(html)
  if (!text) throw new Error('DOCX 解析为空')
  return { unit: 'doc', segments: [{ title: '正文', html: htmlBody(html), text }], text }
}

/* ---- PPTX：JSZip 读 slide XML ---- */
async function parsePptx(blob: Blob): Promise<FlowDoc> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)![1]) - Number(b.match(/slide(\d+)\.xml/)![1]))
  const segments: FlowSegment[] = []
  for (const p of slidePaths) {
    const xml = await zip.file(p)!.async('string')
    const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1].trim()).filter(Boolean)
    if (!texts.length) continue
    const n = Number(p.match(/slide(\d+)\.xml/)![1])
    const html = `<h2 class="ppt-slide-no">第 ${n} 片</h2>` + texts.map((t) => `<p>${esc(t)}</p>`).join('')
    segments.push({ title: `第 ${n} 片 · ${texts[0].slice(0, 24)}`, html, text: texts.join(' ') })
  }
  if (!segments.length) throw new Error('PPTX 解析为空')
  return { unit: 'slide', segments, text: segments.map((s) => s.text).join('\n') }
}

/* ---- TXT：空行分段 ---- */
async function parseTxt(blob: Blob): Promise<FlowDoc> {
  const raw = await blob.text()
  const paras = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  const html = paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`).join('')
  return { unit: 'doc', segments: [{ title: '正文', html, text: raw }], text: raw }
}
