import type { DocKind } from '@/db/db'
import { sanitizeHtmlBody } from '@/lib/sanitizeHtml'
import { readDocumentText } from '@/lib/readDocumentText'
import { parsePptxSlideParagraphs } from '@/lib/pptxXml'

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

export interface FlowTocItem {
  level: number
  title: string
  anchor: string
}

export interface FlowDoc {
  unit: 'chapter' | 'slide' | 'doc'
  segments: FlowSegment[]
  /** 全文纯文本（= segments.text 拼接） */
  text: string
  /** Parsed and scoped Word CSS, never raw styles from the input document. */
  styles?: string
  /** Optional intra-document outline (e.g. Word heading hierarchy). */
  toc?: FlowTocItem[]
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

const EPUB_FIXED_LEN_RE = /^(-?\d*\.?\d+)(pt|px|in|cm|mm|pc)$/i

function parseEpubLengthPt(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const px = Number(trimmed)
    return px > 0 ? px * 0.75 : null
  }
  const m = trimmed.match(EPUB_FIXED_LEN_RE)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  switch (m[2].toLowerCase()) {
    case 'pt': return n
    case 'px': return n * 0.75
    case 'in': return n * 72
    case 'cm': return n * (72 / 2.54)
    case 'mm': return n * (72 / 25.4)
    case 'pc': return n * 12
    default: return null
  }
}

/**
 * 归一化 EPUB 章节内的固定像素/磅值布局（如 Calibre / 微信读书 / 出版社排版的固定宽表格与插图框），
 * 确保正文在 50%–100% 任意栏宽下都能居中铺满且不发生右侧溢出裁切。
 */
function normalizeEpubLayout(body: Element): void {
  const doc = body.ownerDocument
  for (const table of Array.from(body.querySelectorAll<HTMLTableElement>('table'))) {
    table.removeAttribute('width')
    for (const prop of ['width', 'min-width', 'max-width']) table.style.removeProperty(prop)

    const colgroup = Array.from(table.children).find((el): el is HTMLTableColElement => el.tagName.toLowerCase() === 'colgroup')
    const cols = colgroup ? Array.from(colgroup.querySelectorAll<HTMLTableColElement>('col')) : []
    const rows = Array.from(table.rows)
    const maxRowCols = rows.reduce((max, row) => {
      const span = Array.from(row.cells).reduce((acc, c) => acc + (c.colSpan || 1), 0)
      return Math.max(max, span)
    }, 0)
    const colCount = Math.max(cols.reduce((acc, c) => acc + (c.span || 1), 0), maxRowCols)

    if (cols.length === 1) {
      cols[0].removeAttribute('width')
      cols[0].style.width = '100%'
    } else if (cols.length > 1) {
      const parsed = cols.map((col) => parseEpubLengthPt(col.style.width) ?? parseEpubLengthPt(col.getAttribute('width')))
      const allValid = parsed.every((v): v is number => v != null && v > 0)
      const total = allValid ? parsed.reduce((a, b) => a + b, 0) : 0
      cols.forEach((col, i) => {
        col.removeAttribute('width')
        if (total > 0 && parsed[i] != null) {
          col.style.width = `${Number(((parsed[i]! / total) * 100).toFixed(2))}%`
        } else if (EPUB_FIXED_LEN_RE.test(col.style.width.trim())) {
          col.style.removeProperty('width')
        }
      })
    }

    for (const cell of Array.from(table.querySelectorAll<HTMLElement>('tr, td, th'))) {
      cell.removeAttribute('width')
      if (EPUB_FIXED_LEN_RE.test(cell.style.width.trim())) cell.style.removeProperty('width')
      if (EPUB_FIXED_LEN_RE.test(cell.style.minWidth.trim())) cell.style.removeProperty('min-width')
    }

    if (colCount >= 4 && !table.parentElement?.closest('table, .flow-table-scroll')) {
      const wrap = doc.createElement('div')
      wrap.className = 'flow-table-scroll'
      table.parentNode?.insertBefore(wrap, table)
      wrap.appendChild(table)
    }
  }

  for (const el of Array.from(body.querySelectorAll<HTMLElement>('div, section, article, aside, blockquote, figure, p'))) {
    if (el.classList.contains('flow-table-scroll')) continue
    if (EPUB_FIXED_LEN_RE.test(el.style.width.trim())) el.style.removeProperty('width')
    if (EPUB_FIXED_LEN_RE.test(el.style.minWidth.trim())) el.style.removeProperty('min-width')
  }

  for (const img of Array.from(body.querySelectorAll<HTMLImageElement>('img'))) {
    img.removeAttribute('height')
    if (EPUB_FIXED_LEN_RE.test(img.style.height.trim())) img.style.removeProperty('height')
  }
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

function parseEpubChapter(parser: DOMParser, raw: string): Document {
  // XHTML 的空锚点 <a id="…"/> 直接交给 HTML 解析会把后面的正文卷入链接元素。
  if (/<a(?=[\s/])(?:[^<>"']|"[^"]*"|'[^']*')*\/>/i.test(raw)) {
    const xhtml = parser.parseFromString(raw, 'application/xhtml+xml')
    if (xhtml.body) {
      // 先让 XHTML 解析保留锚点边界，再统一走原有的 HTML 图片处理和清洗。
      return parser.parseFromString(xhtml.body.innerHTML, 'text/html')
    }
  }
  return parser.parseFromString(raw, 'text/html')
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
  const parser = new DOMParser()
  for (const path of chapterPaths) {
    const entry = findZipEntry(zip, path) ?? findZipEntry(zip, decodeURIComponent(path))
    if (!entry) continue
    const raw = await zip.file(entry)!.async('string')
    const doc = parseEpubChapter(parser, raw)
    const text = docToText(doc)
    const h = doc.querySelector('h1,h2,h3')
    const title = h?.textContent?.trim() || `第 ${segments.length + 1} 章`
    prepareEpubImages(doc, entry, zip)
    normalizeEpubLayout(doc.body)
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
    const paragraphs = parsePptxSlideParagraphs(xml)
    if (!paragraphs.length) continue
    const n = Number(p.match(/slide(\d+)\.xml/)![1])
    const html = `<h2 class="ppt-slide-no">第 ${n} 片</h2>` + paragraphs.map((line) => `<p>${esc(line).replace(/\n/g, '<br/>')}</p>`).join('')
    segments.push({ title: `第 ${n} 片 · ${paragraphs[0].replace(/\s+/g, ' ').slice(0, 24)}`, html, text: paragraphs.join(' ').replace(/\s+/g, ' ').trim() })
  }
  if (!segments.length) throw new Error('PPTX 解析为空')
  return { unit: 'slide', segments, text: segments.map((s) => s.text).join('\n') }
}

/* ---- TXT：兼容双空行分段与中文单换行缩进分段 ---- */
export function splitTxtParagraphs(raw: string): string[] {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const blocks = normalized.split(/\n\s*\n/).map((s) => s.replace(/^\n+|\n+$/g, '')).filter((s) => s.trim().length > 0)
  const out: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0)
    if (lines.length <= 1) {
      if (lines[0]) out.push(lines[0].trim())
      continue
    }
    const indentedCount = lines.filter((l) => /^[\u3000\t ]{2,}/.test(l)).length
    const avgLen = lines.reduce((sum, l) => sum + l.trim().length, 0) / lines.length
    // 中文网文/小说/长文 TXT 常以单换行（或段首两格全角空格）自然分段，整篇无空行：
    // 若合成单个 <p><br/>，既丢失段间距，又破坏 content-visibility 虚拟化与段落阅读锚点。
    if (blocks.length <= 2 && lines.length >= 3 || indentedCount >= 2 || avgLen >= 38) {
      for (const line of lines) out.push(line.trim())
    } else {
      out.push(lines.map((l) => l.trim()).join('\n'))
    }
  }
  return out
}

async function parseTxt(blob: Blob): Promise<FlowDoc> {
  const raw = await readDocumentText(blob)
  const paras = splitTxtParagraphs(raw)
  const html = paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`).join('')
  return { unit: 'doc', segments: [{ title: '正文', html, text: raw }], text: raw }
}
