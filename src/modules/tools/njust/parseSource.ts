import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Root, RootContent, PhrasingContent } from 'mdast'
import type { Block, Inline, ParsedSource, SourceStats } from './types'

/**
 * 输入解析：txt / Markdown / docx → 中间文档模型。
 * .docx 用 mammoth 转 HTML 后再走同一套 DOM 解析；旧版二进制 .doc 浏览器无法读，直接报错。
 */

const mdParser = (unified() as any).use(remarkParse).use(remarkGfm).use(remarkMath) as unknown as {
  parse: (markdown: string) => Root
}

type Style = Pick<Extract<Inline, { type: 'text' }>, 'bold' | 'italic' | 'strike' | 'code'>

function pushText(out: Inline[], text: string, style: Style = {}) {
  if (!text) return
  const last = out[out.length - 1]
  if (last?.type === 'text' && last.bold === style.bold && last.italic === style.italic && last.strike === style.strike && last.code === style.code) {
    last.text += text
    return
  }
  out.push({ type: 'text', text, ...style })
}

function inlineFromPhrasing(nodes: readonly PhrasingContent[], style: Style = {}, images: { src: string; alt: string }[] = []): Inline[] {
  const out: Inline[] = []
  for (const raw of nodes) {
    const node = raw as unknown as Record<string, unknown>
    const type = String(node.type)
    if (type === 'text') {
      pushText(out, String(node.value ?? ''), style)
    } else if (type === 'strong') {
      out.push(...inlineFromPhrasing(node.children as PhrasingContent[], { ...style, bold: true }, images))
    } else if (type === 'emphasis') {
      out.push(...inlineFromPhrasing(node.children as PhrasingContent[], { ...style, italic: true }, images))
    } else if (type === 'delete') {
      out.push(...inlineFromPhrasing(node.children as PhrasingContent[], { ...style, strike: true }, images))
    } else if (type === 'inlineCode') {
      pushText(out, String(node.value ?? ''), { ...style, code: true })
    } else if (type === 'inlineMath') {
      out.push({ type: 'math', latex: String(node.value ?? '') })
    } else if (type === 'break') {
      out.push({ type: 'break' })
    } else if (type === 'link' || type === 'linkReference') {
      out.push(...inlineFromPhrasing((node.children as PhrasingContent[]) ?? [], style, images))
    } else if (type === 'image') {
      images.push({ src: String(node.url ?? ''), alt: String(node.alt ?? '') })
    } else if (type === 'html') {
      const text = String(node.value ?? '').replace(/<[^>]+>/g, '')
      pushText(out, text, style)
    } else if ('children' in node) {
      out.push(...inlineFromPhrasing(node.children as PhrasingContent[], style, images))
    }
  }
  return out
}

function plainText(nodes: readonly PhrasingContent[]): string {
  return inlineFromPhrasing(nodes)
    .map((i) => (i.type === 'text' ? i.text : i.type === 'math' ? `$${i.latex}$` : ' '))
    .join('')
}

function blockText(block: Block): string {
  if (block.type === 'heading') return block.text
  if (block.type === 'paragraph') return block.inlines.map((i) => (i.type === 'text' ? i.text : i.type === 'math' ? `$${i.latex}$` : ' ')).join('')
  if (block.type === 'table') return [block.headers, ...block.rows].flat().join(' ')
  if (block.type === 'image') return block.alt
  if (block.type === 'code') return block.text
  if (block.type === 'math') return block.latex
  return block.items.flat().map((i) => (i.type === 'text' ? i.text : '')).join(' ')
}

function captionLike(text: string): boolean {
  return /^[表图]\s*[0-9一二三四五六七八九十]/.test(text.trim())
}

/** 把表格/图片前一段“表1-1 … / 图1-1 …”移作题注，避免正文里多出一段 */
function attachCaptions(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const next = blocks[i + 1]
    if (block.type === 'paragraph' && next && (next.type === 'table' || next.type === 'image')) {
      const text = blockText(block).trim()
      if (captionLike(text)) {
        if (next.type === 'table' && !next.caption) next.caption = text
        if (next.type === 'image' && !next.caption) next.caption = text
        continue
      }
    }
    if (block.type === 'image' && !block.caption && captionLike(block.alt)) block.caption = block.alt.trim()
    out.push(block)
  }
  return out
}

function calcStats(blocks: Block[]): SourceStats {
  const stats: SourceStats = { headings: 0, paragraphs: 0, lists: 0, tables: 0, images: 0, formulas: 0, words: 0 }
  for (const b of blocks) {
    if (b.type === 'heading') stats.headings++
    else if (b.type === 'paragraph') stats.paragraphs++
    else if (b.type === 'list') stats.lists++
    else if (b.type === 'table') stats.tables++
    else if (b.type === 'image') stats.images++
    else if (b.type === 'math') stats.formulas++
    if (b.type === 'paragraph') stats.formulas += b.inlines.filter((i) => i.type === 'math').length
  }
  const all = blocks.map(blockText).join('\n')
  const cjk = (all.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (all.match(/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g) ?? []).length
  stats.words = cjk + latin
  return stats
}

function extractMd(children: readonly RootContent[], warnings: string[]): { blocks: Block[]; title?: string } {
  const blocks: Block[] = []
  let title: string | undefined
  let first = true
  for (const raw of children) {
    const node = raw as unknown as Record<string, unknown>
    const type = String(node.type)
    if (first && type === 'heading' && Number(node.depth) === 1) {
      title = plainText(node.children as PhrasingContent[]).trim() || undefined
      first = false
      continue
    }
    first = false
    if (type === 'heading') {
      const level = Math.min(3, Math.max(1, Number(node.depth) || 1)) as 1 | 2 | 3
      const text = plainText(node.children as PhrasingContent[]).trim()
      if (text) blocks.push({ type: 'heading', level, text })
    } else if (type === 'paragraph') {
      const images: { src: string; alt: string }[] = []
      const inlines = inlineFromPhrasing(node.children as PhrasingContent[], {}, images)
      if (inlines.some((i) => i.type === 'math' || (i.type === 'text' && i.text.trim()))) {
        blocks.push({ type: 'paragraph', inlines })
      }
      for (const image of images) if (image.src) blocks.push({ type: 'image', src: image.src, alt: image.alt })
    } else if (type === 'list') {
      const items: Inline[][] = []
      for (const item of (node.children as unknown as Record<string, unknown>[]) ?? []) {
        const firstParagraph = ((item.children as unknown as Record<string, unknown>[]) ?? []).find((c) => c.type === 'paragraph')
        const inlines = firstParagraph ? inlineFromPhrasing(firstParagraph.children as PhrasingContent[]) : []
        if (inlines.length) items.push(inlines)
      }
      if (items.length) blocks.push({ type: 'list', ordered: Boolean(node.ordered), items })
    } else if (type === 'code') {
      blocks.push({ type: 'code', text: String(node.value ?? ''), lang: typeof node.lang === 'string' ? node.lang : undefined })
    } else if (type === 'math') {
      blocks.push({ type: 'math', latex: String(node.value ?? '') })
    } else if (type === 'blockquote') {
      const inner = extractMd((node.children as RootContent[]) ?? [], warnings)
      for (const b of inner.blocks) {
        if (b.type === 'paragraph') blocks.push({ ...b, quote: true })
        else blocks.push(b)
      }
    } else if (type === 'table') {
      const rows = (node.children as unknown as Record<string, unknown>[]) ?? []
      const cells = rows.map((row) => (((row.children as unknown as Record<string, unknown>[]) ?? []).map((cell) => plainText(cell.children as PhrasingContent[]).trim())))
      if (cells.length) {
        blocks.push({ type: 'table', headers: cells[0], rows: cells.slice(1) })
      }
    } else if (type === 'image') {
      if (node.url) blocks.push({ type: 'image', src: String(node.url), alt: String(node.alt ?? '') })
    } else if (type === 'html') {
      const text = String(node.value ?? '').replace(/<[^>]+>/g, '').trim()
      if (text) blocks.push({ type: 'paragraph', inlines: [{ type: 'text', text }] })
    } else if (type === 'thematicBreak' || type === 'definition' || type === 'footnoteDefinition') {
      // 分隔线/链接定义/脚注定义不进正文
    } else {
      warnings.push(`忽略了不支持的 Markdown 节点：${type}`)
    }
  }
  return { blocks, title }
}

export function parseMarkdownSource(markdown: string): ParsedSource {
  const warnings: string[] = []
  const root = mdParser.parse(markdown.replace(/\r\n?/g, '\n'))
  const { blocks, title } = extractMd(root.children, warnings)
  const withCaptions = attachCaptions(blocks)
  return { blocks: withCaptions, title, warnings: [...new Set(warnings)], stats: calcStats(withCaptions) }
}

const TEXT_HEADING = /^(?:#{1,6}\s+|([一二三四五六七八九十百]+)[、.．]\s*|(\d+\.\d+(?:\.\d+)?)\s+)/

function inlineFromPlain(text: string): Inline[] {
  const out: Inline[] = []
  const re = /(\$[^$\n]+\$|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) pushText(out, text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('$')) out.push({ type: 'math', latex: token.slice(1, -1) })
    else if (token.startsWith('**')) pushText(out, token.slice(2, -2), { bold: true })
    else pushText(out, token.slice(1, -1), { italic: true })
    last = m.index + token.length
  }
  if (last < text.length) pushText(out, text.slice(last))
  return out
}

export function parseTextSource(text: string): ParsedSource {
  const warnings: string[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let title: string | undefined
  let sawContent = false
  let list: { ordered: boolean; items: Inline[][] } | null = null

  const flushList = () => {
    if (list?.items.length) blocks.push({ type: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushList()
      continue
    }
    const heading = TEXT_HEADING.exec(line.trim())
    if (heading) {
      flushList()
      const text = line.trim().replace(TEXT_HEADING, '').trim()
      if (!text) continue
      const hashes = /^(#{1,6})\s+/.exec(line.trim())
      const level: 1 | 2 | 3 = hashes
        ? Math.min(3, hashes[1].length) as 1 | 2 | 3
        : heading[1] ? 1 : heading[2]?.split('.').length === 3 ? 3 : 2
      // 纯文本里「一、引言」通常是章节，不像 Markdown 的 # 那样默认当题目
      if (!sawContent && level === 1 && hashes) {
        title = text
        sawContent = true
        continue
      }
      sawContent = true
      blocks.push({ type: 'heading', level, text })
      continue
    }
    sawContent = true
    if (/^[-*+]\s+/.test(line)) {
      if (list && list.ordered) flushList()
      list ??= { ordered: false, items: [] }
      list.items.push(inlineFromPlain(line.replace(/^[-*+]\s+/, '')))
      continue
    }
    if (/^\d+[.)、]\s+/.test(line)) {
      if (list && !list.ordered) flushList()
      list ??= { ordered: true, items: [] }
      list.items.push(inlineFromPlain(line.replace(/^\d+[.)、]\s+/, '')))
      continue
    }
    flushList()
    const math = /^\$\$(.+)\$\$$/.exec(line.trim())
    if (math) {
      blocks.push({ type: 'math', latex: math[1].trim() })
      continue
    }
    blocks.push({ type: 'paragraph', inlines: inlineFromPlain(line.trim()) })
  }
  flushList()
  const withCaptions = attachCaptions(blocks)
  return { blocks: withCaptions, title, warnings, stats: calcStats(withCaptions) }
}

/* ---------------- DOCX ---------------- */

function inlineFromElement(el: Element, images: { src: string; alt: string }[]): Inline[] {
  const out: Inline[] = []
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(out, node.textContent ?? '')
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const child = node as Element
    const tag = child.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'b') out.push(...inlineFromElement(child, images).map((i) => i.type === 'text' ? { ...i, bold: true } : i))
    else if (tag === 'em' || tag === 'i') out.push(...inlineFromElement(child, images).map((i) => i.type === 'text' ? { ...i, italic: true } : i))
    else if (tag === 'code') pushText(out, child.textContent ?? '', { code: true })
    else if (tag === 'br') out.push({ type: 'break' })
    else if (tag === 'img') {
      const src = child.getAttribute('src') ?? ''
      if (src) images.push({ src, alt: child.getAttribute('alt') ?? '' })
    } else if (tag === 'a' || tag === 'span' || tag === 'sup' || tag === 'sub' || tag === 'u') {
      out.push(...inlineFromElement(child, images))
    } else {
      out.push(...inlineFromElement(child, images))
    }
  }
  return out
}

function elementText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function parseHtmlBody(body: Element, warnings: string[]): { blocks: Block[]; title?: string } {
  const blocks: Block[] = []
  let title: string | undefined
  let first = true
  let sawHeading = false
  const walk = (parent: Element) => {
    for (const node of Array.from(parent.children)) {
      const tag = node.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(3, Number(tag[1]) || 1) as 1 | 2 | 3
        const text = elementText(node)
        if (text) blocks.push({ type: 'heading', level, text })
        sawHeading = true
        first = false
      } else if (tag === 'p') {
        const text = elementText(node)
        // Word 报告常见：第一个短段落是题目，后面才是各级标题。只吃第一段，不把
        // 一级章节标题误当题目（Word 源稿不一定用 Title 样式）。
        if (first && !sawHeading && text && text.length <= 100) {
          title = text
          first = false
          continue
        }
        first = false
        const hLevel = /^[一二三四五六七八九十]+、/.test(text) ? 1
          : /^\d+\.\d+\.\d+\s/.test(text) ? 3
            : /^\d+\.\d+\s/.test(text) ? 2 : 0
        if (hLevel && text.length <= 80) {
          blocks.push({ type: 'heading', level: hLevel as 1 | 2 | 3, text })
          sawHeading = true
          continue
        }
        const images: { src: string; alt: string }[] = []
        const inlines = inlineFromElement(node, images)
        if (inlines.some((i) => i.type === 'math' || (i.type === 'text' && i.text.trim()))) blocks.push({ type: 'paragraph', inlines })
        for (const image of images) if (image.src) blocks.push({ type: 'image', src: image.src, alt: image.alt })
      } else if (tag === 'ul' || tag === 'ol') {
        const items: Inline[][] = []
        for (const li of Array.from(node.children).filter((n) => n.tagName.toLowerCase() === 'li')) {
          const inlines = inlineFromElement(li, [])
          if (inlines.length) items.push(inlines)
        }
        if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items })
        first = false
      } else if (tag === 'pre') {
        blocks.push({ type: 'code', text: node.textContent ?? '' })
        first = false
      } else if (tag === 'blockquote') {
        const inner = parseHtmlBody(node, warnings)
        for (const b of inner.blocks) blocks.push(b.type === 'paragraph' ? { ...b, quote: true } : b)
        first = false
      } else if (tag === 'table') {
        const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.querySelectorAll('th,td')).map((cell) => elementText(cell)),
        ).filter((row) => row.length)
        // 生成件/模板里的封面信息表和评语框不是正文表格，导入时跳过
        const isReviewBox = rows.length === 1 && rows[0].length === 1 && /^评\s*语/.test(rows[0][0])
        const isCoverFields = rows.length === 6 && rows[0].length === 2
          && /姓\s*名/.test(rows[0][0])
          && rows.some((r) => /学\s*号/.test(r[0]))
        if (rows.length && !isReviewBox && !isCoverFields) blocks.push({ type: 'table', headers: rows[0], rows: rows.slice(1) })
        first = false
      } else if (tag === 'img') {
        const src = node.getAttribute('src') ?? ''
        if (src) blocks.push({ type: 'image', src, alt: node.getAttribute('alt') ?? '' })
        first = false
      } else if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'body') {
        walk(node)
      } else if (tag === 'figure') {
        walk(node)
      } else {
        const text = elementText(node)
        if (text) blocks.push({ type: 'paragraph', inlines: [{ type: 'text', text }] })
        first = false
      }
    }
  }
  walk(body)
  return { blocks, title }
}

function isOldDoc(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength))
  return b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
}

function isZip(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b
}

export async function parseDocxSource(buffer: ArrayBuffer): Promise<ParsedSource> {
  if (isOldDoc(buffer)) {
    throw new Error('这是旧版二进制 .doc，浏览器无法读取。请在 Word 里另存为 .docx 后再上传。')
  }
  if (!isZip(buffer)) throw new Error('文件不是有效的 .docx（可能是改过扩展名的旧 Word 文档）')

  const warnings: string[] = []
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')
    if (xml && /<m:oMath|<m:oMathPara/.test(xml)) warnings.push('docx 里的 Word 公式没有导入，请改用 LaTeX（$...$）或在生成后手动补公式')
    if (xml && /<w:drawing>/.test(xml) && /\.(emf|wmf)/i.test(xml)) warnings.push('docx 里有 EMF/WMF 矢量图，浏览器无法转成图片；请在 Word 中另存为 PNG 后补充上传')
  } catch {
    throw new Error('无法解压 .docx，文件可能已损坏')
  }

  const mammoth = (await import('mammoth')) as any
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => ({
        src: `data:${image.contentType};base64,${await image.read('base64')}`,
      })),
    },
  )
  for (const message of result.messages) {
    if (message.type === 'warning' && /image/i.test(message.message)) warnings.push('部分 Word 图片未能读取，请在补充图片里重新上传')
  }

  const doc = new DOMParser().parseFromString(result.value, 'text/html')
  const { blocks, title } = parseHtmlBody(doc.body, warnings)
  const withCaptions = attachCaptions(blocks)
  return { blocks: withCaptions, title, warnings: [...new Set(warnings)], stats: calcStats(withCaptions) }
}

export async function parseSourceFile(file: File): Promise<ParsedSource> {
  const name = file.name.toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  if (ext === 'txt' || file.type === 'text/plain') return parseTextSource(await file.text())
  if (ext === 'md' || ext === 'markdown' || file.type === 'text/markdown') return parseMarkdownSource(await file.text())
  if (ext === 'docx' || ext === 'doc') return parseDocxSource(await file.arrayBuffer())
  throw new Error('只支持 .txt、.md / .markdown 和 .docx；旧版 .doc 请先另存为 .docx')
}
