import type { DocKind } from '@/db/db'
import { sanitizeHtmlBody } from '@/lib/sanitizeHtml'
import { readDocumentText } from '@/lib/readDocumentText'

/**
 * 流式文档解析（v1.3）：EPUB / DOCX / PPTX / TXT → 统一段落模型，
 * 供 FlowReader 渲染与全文索引共用。段落 = 章（epub）/ 片（pptx）/ 篇（docx/txt）。
 *
 * segments.html 一律经 sanitizeHtmlBody 白名单清洗后才交给 dangerouslySetInnerHTML，
 * 外来文档（EPUB/DOCX）不再能把 onerror 之类的属性带进 DOM。
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
  /** Parsed and scoped Word CSS, never raw styles from the input document. */
  styles?: string
  /** EPUB 图片按需取：path 来自 data-epub-src，返回 blob URL */
  resolveImage?: (path: string) => Promise<string | null>
  /** 释放解析过程创建的 blob URL（文档关闭时调用，防内存泄漏） */
  dispose?: () => void
}

function docToText(doc: Document): string {
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

/* ---- EPUB：JSZip 按 spine 解析章节（图片按需加载，打开时不读全部资源） ---- */

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

/** 1×1 透明 GIF：图片真正进入视口前先占位，避免长按/点击拿到坏图 */
const EPUB_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function imageMime(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.gif$/i.test(path)) return 'image/gif'
  if (/\.svg$/i.test(path)) return 'image/svg+xml'
  if (/\.webp$/i.test(path)) return 'image/webp'
  return 'image/jpeg'
}

/**
 * 图片先改写成 data-epub-src 占位，由 FlowReader 用 IntersectionObserver 按需取。
 * 旧实现会在打开时逐张解压整本 EPUB 的图片，图多的书首屏要等所有字节读完。
 */
function prepareEpubImages(doc: Document, chapterPath: string, zip: Zip): void {
  const baseDir = chapterPath.includes('/') ? chapterPath.slice(0, chapterPath.lastIndexOf('/') + 1) : ''
  for (const el of Array.from(doc.querySelectorAll('img[src]'))) {
    const src = el.getAttribute('src')
    if (!src) continue
    if (/^(data:|https?:|blob:)/i.test(src)) {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('decoding', 'async')
      continue
    }
    const path = findZipEntry(zip, resolveZipPath(baseDir, src))
    if (!path) {
      el.remove()
      continue
    }
    el.setAttribute('data-epub-src', path)
    el.setAttribute('src', EPUB_IMG_PLACEHOLDER)
    el.setAttribute('loading', 'lazy')
    el.setAttribute('decoding', 'async')
  }
}

async function parseEpub(blob: Blob): Promise<FlowDoc> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const urls: string[] = []
  const imageCache = new Map<string, string>()

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
    // 每章只解析一次 DOM：文本、标题、图片占位、清洗都复用这棵树
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    const text = docToText(doc)
    const h = doc.querySelector('h1,h2,h3')
    const title = h?.textContent?.trim() || `第 ${segments.length + 1} 章`
    prepareEpubImages(doc, entry, zip)
    if (!text && !doc.querySelector('img')) continue
    const html = sanitizeHtmlBody(doc.body)
    segments.push({ title, html, text })
  }
  if (!segments.length) throw new Error('EPUB 解析为空')

  const resolveImage = async (path: string): Promise<string | null> => {
    const cached = imageCache.get(path)
    if (cached) return cached
    const file = zip.file(path)
    if (!file) return null
    try {
      const blob = new Blob([await file.async('arraybuffer')], { type: imageMime(path) })
      const url = URL.createObjectURL(blob)
      urls.push(url)
      imageCache.set(path, url)
      return url
    } catch {
      return null
    }
  }

  return {
    unit: 'chapter',
    segments,
    text: segments.map((s) => s.text).join('\n'),
    resolveImage,
    dispose: () => { for (const u of urls) { try { URL.revokeObjectURL(u) } catch { /* ignore */ } } },
  }
}

/* ---- DOCX：保留格式与原生公式的 Word 渲染器 ---- */
async function parseDocx(blob: Blob): Promise<FlowDoc> {
  return (await import('./wordDoc')).parseWordDoc(blob)
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
  const raw = await readDocumentText(blob)
  const paras = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  const html = paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`).join('')
  return { unit: 'doc', segments: [{ title: '正文', html, text: raw }], text: raw }
}
