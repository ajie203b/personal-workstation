import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, HeightRule, ImageRun,
  LineRuleType, PageBreak, PageNumber, Packer, Paragraph, SectionType, Table, TableCell,
  TableLayoutType, TableOfContents, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
  convertMillimetersToTwip,
  type FileChild, type ISectionOptions, type ParagraphChild,
} from 'docx'
import type { Block, BinaryImage, Inline, ReportLogos, ReportMeta, ReportOptions } from './types'
import { latexToMath, mathNode, renderFormulaPng } from './formula'
import { inlinesPlain } from './parseSource'

const mm = (n: number) => convertMillimetersToTwip(n)
const pt = (n: number) => Math.round(n * 20)
const cm = (n: number) => Math.round(n * 567)

const CN = { ascii: 'Times New Roman', eastAsia: '宋体', hAnsi: 'Times New Roman', cs: 'Times New Roman' }
const HEI = { ...CN, eastAsia: '黑体' }
const FS = { ...CN, eastAsia: '仿宋' }
const CODE = { ascii: 'Consolas', eastAsia: '宋体', hAnsi: 'Consolas', cs: 'Consolas' }

const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const line = (size: number) => ({ style: BorderStyle.SINGLE, size, color: '000000' })
const CODE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'E2E4E8', space: 4 }

function run(text: string, opts: { size?: number; bold?: boolean; italic?: boolean; strike?: boolean; font?: typeof CN; color?: string; shade?: string } = {}): TextRun {
  return new TextRun({
    text,
    size: Math.round((opts.size ?? 12) * 2),
    bold: opts.bold,
    italics: opts.italic,
    strike: opts.strike,
    color: opts.color ?? '000000',
    font: opts.font ?? CN,
    shading: opts.shade ? { fill: opts.shade, type: 'clear', color: 'auto' } : undefined,
  })
}

function imageRun(img: BinaryImage, widthPx: number, heightPx: number): ImageRun {
  return new ImageRun({
    data: img.data,
    type: img.type === 'jpg' ? 'jpg' : img.type,
    transformation: { width: Math.max(1, Math.round(widthPx)), height: Math.max(1, Math.round(heightPx)) },
  })
}

async function measureBlob(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close?.()
    }
  }
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')) }
    img.src = url
  })
}

async function transcodeToPng(blob: Blob): Promise<BinaryImage> {
  if (typeof document === 'undefined') throw new Error('WebP 图片暂不支持，请导出为 PNG 后重试')
  const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : null
  const canvas = document.createElement('canvas')
  try {
    let width = 0
    let height = 0
    if (bitmap) {
      width = bitmap.width
      height = bitmap.height
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布不可用')
      ctx.drawImage(bitmap, 0, 0)
    } else {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const el = new Image()
        el.onload = () => { URL.revokeObjectURL(url); resolve(el) }
        el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')) }
        el.src = url
      })
      width = img.naturalWidth
      height = img.naturalHeight
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布不可用')
      ctx.drawImage(img, 0, 0)
    }
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('WebP 转 PNG 失败'))), 'image/png')
    })
    return { data: new Uint8Array(await pngBlob.arrayBuffer()), type: 'png', width, height }
  } finally {
    bitmap?.close?.()
    canvas.width = 0
    canvas.height = 0
  }
}

async function blobToImage(blob: Blob): Promise<BinaryImage> {
  if (blob.type.includes('svg')) throw new Error('SVG 图片暂不支持，请导出为 PNG 后重试')
  if (blob.type.includes('webp')) return transcodeToPng(blob)
  const data = new Uint8Array(await blob.arrayBuffer())
  const type = blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg'
    : blob.type.includes('gif') ? 'gif'
      : blob.type.includes('bmp') ? 'bmp' : 'png'
  const { width, height } = await measureBlob(blob)
  return { data, type, width, height }
}

async function dataUrlImage(src: string): Promise<BinaryImage | null> {
  const match = /^data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,([\s\S]+)$/i.exec(src)
  if (!match) return null
  const mime = match[1].toLowerCase()
  const binary = atob(match[2])
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
  const blob = new Blob([data], { type: mime === 'jpg' || mime === 'jpeg' ? 'image/jpeg' : `image/${mime}` })
  if (mime === 'webp') return transcodeToPng(blob)
  const type = mime === 'jpeg' || mime === 'jpg' ? 'jpg' : mime === 'gif' ? 'gif' : mime === 'bmp' ? 'bmp' : 'png'
  const { width, height } = await measureBlob(blob)
  return { data, type, width, height }
}

function fitImage(img: BinaryImage, maxW: number, maxH: number, minW = 24, minH = 16) {
  const scale = Math.min(1, maxW / img.width, maxH / img.height)
  return { width: Math.max(minW, Math.round(img.width * scale)), height: Math.max(minH, Math.round(img.height * scale)) }
}

/** 从 public/njust 加载模板 Logo（模板里拆出来的南理工校徽） */
export async function loadNjustLogos(): Promise<ReportLogos> {
  const load = async (name: string): Promise<BinaryImage> => {
    const res = await fetch(`${import.meta.env.BASE_URL}njust/${name}`, { cache: 'force-cache' })
    if (!res.ok) throw new Error('模板 Logo 缺失，请重新安装应用')
    const blob = await res.blob()
    return blobToImage(blob)
  }
  return { cover: await load('logo-cover.png'), header: await load('logo-header.png') }
}

export async function resolveImages(
  blocks: Block[],
  supplements: Map<string, string>,
  warnings: string[],
): Promise<Block[]> {
  const out: (Block | null)[] = await Promise.all(blocks.map(async (block) => {
    if (block.type !== 'image') return block
    let src = block.src
    if (!src.startsWith('data:')) {
      if (/^https?:/i.test(src)) {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 15_000)
          const res = await fetch(src, { signal: controller.signal, cache: 'no-store' })
          clearTimeout(timer)
          if (!res.ok) throw new Error(String(res.status))
          const blob = await res.blob()
          if (!blob.type.startsWith('image/')) throw new Error('不是图片')
          src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('读取失败'))
            reader.readAsDataURL(blob)
          })
        } catch {
          warnings.push(`图片下载失败，已跳过：${src}`)
          return null
        }
      } else {
        const name = src.split(/[\\/]/).pop()?.toLowerCase() ?? ''
        const found = supplements.get(name)
        if (!found) {
          warnings.push(`找不到图片「${name || src}」，请在补充图片里上传后重试`)
          return null
        }
        src = found
      }
    }
    return { ...block, src }
  }))
  return out.filter((b): b is Block => Boolean(b))
}

export function cnNo(n: number): string {
  const nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (n <= 0) return String(n)
  if (n <= 10) return nums[n - 1]
  if (n < 20) return `十${nums[n - 11]}`
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${nums[tens - 1]}十${ones ? nums[ones - 1] : ''}`
  }
  return String(n)
}

function stripHeadingNo(text: string): string {
  return text
    .replace(/^[一二三四五六七八九十百]+[、.．]\s*/, '')
    .replace(/^\d+(?:\.\d+)*[、.．]?\s+/, '')
    .replace(/^第[一二三四五六七八九十百]+[章节]\s*/, '')
    .trim()
}

function captionNo(kind: '图' | '表', chapter: number, seq: number, caption?: string): string {
  const base = `${kind}${Math.max(1, chapter)}-${seq}`
  const text = (caption ?? '').trim()
  if (text && new RegExp(`^${kind}\\s*\\d`).test(text)) return text
  return text ? `${base}  ${text}` : base
}

interface BuildInput {
  meta: ReportMeta
  blocks: Block[]
  options: ReportOptions
  logos?: ReportLogos
  warnings?: string[]
}

const TALL_MATH_RE = /\\(?:[dt]?frac|sum|prod|int|sqrt|overline)\b/

export async function buildReport(input: BuildInput): Promise<{ blob: Blob; warnings: string[] }> {
  const { meta, options, logos } = input
  if (options.cover && !logos?.cover) throw new Error('缺少封面校徽图片')
  if (options.headerFooter && !logos?.header) throw new Error('缺少页眉校徽图片')

  const blocks = input.blocks
  const warnings = [...(input.warnings ?? [])]
  const formulaCache = new Map<string, BinaryImage | null>()

  const formulaImage = async (latex: string, display: boolean) => {
    const key = `${display ? 'd' : 'i'}:${latex}`
    if (!formulaCache.has(key)) formulaCache.set(key, await renderFormulaPng(latex, display))
    return formulaCache.get(key) ?? null
  }

  const inlineChildren = async (
    inlines: Inline[],
    size = 12,
    baseBold = false,
    baseItalic = false,
    baseStrike = false,
  ): Promise<{ children: ParagraphChild[]; needsAtLeastLine: boolean }> => {
    const children: ParagraphChild[] = []
    let needsAtLeastLine = false
    for (const item of inlines) {
      if (item.type === 'text') {
        children.push(run(item.text, {
          size: item.code ? Math.max(9, size - 1) : size,
          bold: baseBold || item.bold,
          italic: baseItalic || item.italic,
          strike: baseStrike || item.strike,
          font: item.code ? CODE : CN,
          shade: item.code ? 'F2F2F2' : undefined,
        }))
      } else if (item.type === 'break') {
        children.push(new TextRun({ break: 1 }))
      } else {
        const comps = latexToMath(item.latex)
        if (comps) {
          if (TALL_MATH_RE.test(item.latex)) needsAtLeastLine = true
          children.push(mathNode(comps))
        } else {
          const img = await formulaImage(item.latex, false)
          if (img) {
            needsAtLeastLine = true
            const fit = fitImage(img, 240, 26, 8, 10)
            children.push(imageRun(img, fit.width, fit.height))
          } else {
            warnings.push(`行内公式未能转换：${item.latex.slice(0, 60)}`)
            children.push(run(`$${item.latex}$`, { size, italic: true }))
          }
        }
      }
    }
    return { children, needsAtLeastLine }
  }

  const bodyParagraph = async (inlines: Inline[], opts: { quote?: boolean; noIndent?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) => {
    const { children, needsAtLeastLine } = await inlineChildren(inlines)
    return new Paragraph({
      alignment: opts.align ?? AlignmentType.BOTH,
      spacing: { before: 0, after: 0, line: 400, lineRule: needsAtLeastLine ? LineRuleType.AT_LEAST : LineRuleType.EXACT },
      indent: opts.quote || opts.noIndent ? { left: opts.quote ? 480 : 0 } : { firstLine: 480 },
      children: children.length ? children : [run(' ')],
    })
  }

  const tableCaption = (text: string, chapter: number, seq: number) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: pt(6), after: pt(3), line: 240, lineRule: LineRuleType.AUTO },
      keepNext: true,
      children: [run(captionNo('表', chapter, seq, text), { size: 10.5 })],
    })

  const figureCaption = (text: string, chapter: number, seq: number) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: pt(8), line: 240, lineRule: LineRuleType.AUTO },
      children: [run(captionNo('图', chapter, seq, text), { size: 10.5 })],
    })

  const buildTable = async (block: Extract<Block, { type: 'table' }>, chapter: number, seq: number, fallbackTitle: string): Promise<FileChild[]> => {
    const cols = Math.max(1, block.headers.length)
    const rows: Inline[][][] = [block.headers, ...block.rows].map((r) => {
      const row = r.slice(0, cols)
      while (row.length < cols) row.push([])
      return row
    })
    const weights = Array.from({ length: cols }, (_, i) => {
      const maxLen = Math.max(4, ...rows.map((r) => inlinesPlain(r[i] ?? []).length))
      return Math.min(26, maxLen)
    })
    const sum = weights.reduce((a, b) => a + b, 0) || 1
    let widths = weights.map((w) => Math.max(2.0, (17 * w) / sum))
    const wSum = widths.reduce((a, b) => a + b, 0)
    widths = widths.map((w) => (w * 17) / wSum)

    // 串行渲染单元格，避免多个回退公式同时挂在 (0,0) 导致 html-to-image 截串图
    const tableRows: TableRow[] = []
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex]
      const isHeader = rowIndex === 0
      const isLast = rowIndex === rows.length - 1
      const builtCells: TableCell[] = []
      for (let i = 0; i < cells.length; i++) {
        const { children } = await inlineChildren(cells[i], 10.5, isHeader)
        builtCells.push(new TableCell({
          width: { size: cm(widths[i]), type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 20, bottom: 20, left: 80, right: 80 },
          borders: {
            top: isHeader ? line(12) : NONE,
            bottom: isLast ? line(12) : isHeader ? line(6) : NONE,
            left: NONE,
            right: NONE,
          },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: pt(1), after: pt(1), line: 240, lineRule: LineRuleType.AUTO },
            children: children.length ? children : [run(' ', { size: 10.5, bold: isHeader })],
          })],
        }))
      }
      tableRows.push(new TableRow({
        cantSplit: true,
        tableHeader: isHeader,
        height: { value: cm(0.62), rule: HeightRule.ATLEAST },
        children: builtCells,
      }))
    }

    return [
      tableCaption(block.caption || fallbackTitle, chapter, seq),
      new Table({
        rows: tableRows,
        width: { size: cm(17), type: WidthType.DXA },
        columnWidths: widths.map(cm),
        layout: TableLayoutType.FIXED,
        alignment: AlignmentType.CENTER,
        borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
      }),
      new Paragraph({ spacing: { before: 0, after: pt(6), line: 1, lineRule: LineRuleType.EXACT }, children: [run(' ', { size: 1 })] }),
    ]
  }

  const buildImage = async (block: Extract<Block, { type: 'image' }>, chapter: number, seq: number, fallbackTitle: string): Promise<FileChild[] | null> => {
    const img = await dataUrlImage(block.src)
    if (!img) {
      warnings.push(`图片无法读取：${block.alt || '未命名图片'}`)
      return null
    }
    const fit = fitImage(img, 518, 720)
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: pt(6), after: pt(3), line: 240, lineRule: LineRuleType.AUTO },
        keepNext: true,
        children: [imageRun(img, fit.width, fit.height)],
      }),
      figureCaption(block.caption || block.alt || fallbackTitle, chapter, seq),
    ]
  }

  async function buildBody(children: FileChild[]) {
    let chapter = 0
    let h2 = 0
    let h3 = 0
    let figure = 0
    let tableSeq = 0
    let currentHeading = ''

    for (const block of blocks) {
      if (block.type === 'heading') {
        const clean = stripHeadingNo(block.text)
        if (block.level === 1) {
          chapter++
          h2 = 0
          h3 = 0
          figure = 0
          tableSeq = 0
        } else if (block.level === 2) {
          h2++
          h3 = 0
        } else {
          h3++
        }
        const ch = Math.max(1, chapter)
        const prefix = !options.autoNumberHeadings
          ? ''
          : block.level === 1 ? `${cnNo(chapter)}、`
            : block.level === 2 ? `${ch}.${Math.max(1, h2)} `
              : `${ch}.${Math.max(1, h2)}.${Math.max(1, h3)} `
        const text = options.autoNumberHeadings ? `${prefix}${clean}` : block.text
        currentHeading = clean
        const size = block.level === 1 ? 16 : block.level === 2 ? 14 : 12
        const font = block.level === 3 ? HEI : CN
        children.push(new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          alignment: AlignmentType.LEFT,
          keepNext: true,
          spacing: {
            before: block.level === 1 ? pt(12) : block.level === 2 ? pt(6) : 0,
            after: block.level === 1 ? pt(12) : pt(6),
            line: 240,
            lineRule: LineRuleType.AUTO,
          },
          children: [run(text, { size, bold: true, font })],
        }))
      } else if (block.type === 'paragraph') {
        children.push(await bodyParagraph(block.inlines, { quote: block.quote }))
      } else if (block.type === 'list') {
        const counters = new Map<number, number>()
        const bullets = ['•', '◦', '▪']
        for (const item of block.items) {
          const depth = Math.max(0, Math.min(4, item.depth))
          for (const key of Array.from(counters.keys())) {
            if (key > depth) counters.delete(key)
          }
          let marker: string
          if (item.ordered) {
            const nextNum = (counters.get(depth) ?? 0) + 1
            counters.set(depth, nextNum)
            marker = `${nextNum}.\t`
          } else {
            counters.delete(depth)
            marker = `${bullets[depth % bullets.length]}\t`
          }
          const left = 480 + depth * 420
          // 正左缩进 + tab 对齐：Word 里逐级对齐，且避免负 text-indent 在流式阅读器中被裁切
          const { children: c, needsAtLeastLine } = await inlineChildren([{ type: 'text', text: marker }, ...item.inlines])
          children.push(new Paragraph({
            alignment: AlignmentType.BOTH,
            spacing: { before: 0, after: 0, line: 400, lineRule: needsAtLeastLine ? LineRuleType.AT_LEAST : LineRuleType.EXACT },
            indent: { left },
            tabStops: [{ type: TabStopType.LEFT, position: left + 360 }],
            children: c,
          }))
        }
      } else if (block.type === 'code') {
        const lines = block.text.replace(/\r/g, '').split('\n')
        lines.forEach((ln, i) => {
          children.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: i === 0 ? pt(4) : 0, after: i === lines.length - 1 ? pt(6) : 0, line: pt(14), lineRule: LineRuleType.AT_LEAST },
            indent: { left: pt(10), right: pt(10) },
            shading: { fill: 'F6F7F9', type: 'clear', color: 'auto' },
            border: { top: CODE_BORDER, bottom: CODE_BORDER, left: CODE_BORDER, right: CODE_BORDER },
            keepNext: i < lines.length - 1,
            children: [run(ln || ' ', { size: 9, font: CODE })],
          }))
        })
      } else if (block.type === 'math') {
        const comps = latexToMath(block.latex)
        if (comps) {
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: pt(3), after: pt(3), line: 240, lineRule: LineRuleType.AUTO },
            keepLines: true,
            children: [mathNode(comps)],
          }))
        } else {
          const img = await formulaImage(block.latex, true)
          if (img) {
            const fit = fitImage(img, 518, 400)
            const scale = 0.9
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: pt(3), after: pt(3), line: 240, lineRule: LineRuleType.AUTO },
              children: [imageRun(img, fit.width * scale, fit.height * scale)],
            }))
          } else {
            warnings.push(`公式未能转换：${block.latex.slice(0, 60)}`)
            children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`$${block.latex}$`, { size: 12, italic: true })] }))
          }
        }
      } else if (block.type === 'image') {
        figure++
        const built = await buildImage(block, Math.max(1, chapter), figure, currentHeading)
        if (built) children.push(...built)
        else figure--
      } else if (block.type === 'table') {
        tableSeq++
        children.push(...await buildTable(block, Math.max(1, chapter), tableSeq, currentHeading))
      }
    }
  }

  const coverChildren: FileChild[] = []
  if (options.cover && logos) {
    coverChildren.push(new Paragraph({
      spacing: { before: 0, after: 0, line: 1, lineRule: LineRuleType.EXACT },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 1 } },
      children: [run(' ', { size: 1 })],
    }))
    const coverFit = fitImage(logos.cover, 488, 200)
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: pt(24), after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [imageRun(logos.cover, coverFit.width, coverFit.height)],
    }))
    const course = meta.course.trim() || '南京理工大学'
    const quoted = /^[“"]/.test(course) ? course : `“${course}”`
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: pt(30), after: pt(2), line: 240, lineRule: LineRuleType.AUTO },
      children: [run(quoted, { size: 26, bold: true })],
    }))
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: pt(8), line: 240, lineRule: LineRuleType.AUTO },
      children: [run(meta.reportType.trim() || '大作业', { size: 26, bold: true })],
    }))

    const fields: [string, string][] = [
      ['姓    名', meta.name],
      ['学    号', meta.studentId],
      ['学    院', meta.college],
      ['专    业', meta.major],
      ['指导教师', meta.teacher],
      ['分    数', meta.score],
    ]
    const coverRows = fields.map(([label, value]) => new TableRow({
      height: { value: cm(1.12), rule: HeightRule.ATLEAST },
      children: [
        new TableCell({
          width: { size: cm(3.2), type: WidthType.DXA },
          verticalAlign: VerticalAlign.BOTTOM,
          margins: { top: 20, bottom: 20, left: 80, right: 80 },
          borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
          children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 240, lineRule: LineRuleType.AUTO }, children: [run(label, { size: 16, font: FS })] })],
        }),
        new TableCell({
          width: { size: cm(5.0), type: WidthType.DXA },
          verticalAlign: VerticalAlign.BOTTOM,
          margins: { top: 20, bottom: 20, left: 80, right: 80 },
          borders: { top: NONE, left: NONE, right: NONE, bottom: line(8) },
          children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 240, lineRule: LineRuleType.AUTO }, children: [run(value || ' ', { size: 16, font: FS })] })],
        }),
      ],
    }))
    coverChildren.push(new Paragraph({ spacing: { before: 0, after: pt(42), line: 1, lineRule: LineRuleType.EXACT }, children: [run(' ', { size: 1 })] }))
    coverChildren.push(new Table({
      rows: coverRows,
      width: { size: cm(8.2), type: WidthType.DXA },
      columnWidths: [cm(3.2), cm(5.0)],
      layout: TableLayoutType.FIXED,
      alignment: AlignmentType.CENTER,
      borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    }))
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: pt(54), after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [run(meta.date.trim() || `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`, { size: 18 })],
    }))
  }

  const bodyChildren: FileChild[] = []
  if (options.toc) {
    bodyChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: pt(8), after: pt(12), line: 240, lineRule: LineRuleType.AUTO },
      children: [run('目  录', { size: 16, bold: true, font: CN })],
    }))
    bodyChildren.push(new TableOfContents('目  录', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }

  bodyChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: pt(16), after: pt(16), line: 240, lineRule: LineRuleType.AUTO },
    children: [run(meta.title.trim() || '课程报告', { size: 22, bold: true })],
  }))

  const sid = meta.studentId.trim()
  const authorName = meta.name.trim()
  if (sid || authorName) {
    const infoLine = [sid ? `学号：${sid}` : '', authorName ? `姓名：${authorName}` : ''].filter(Boolean).join('    ')
    bodyChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: pt(6), after: pt(6), line: 240, lineRule: LineRuleType.AUTO },
      children: [run(infoLine, { size: 12 })],
    }))
  }

  if (options.reviewBox) {
    bodyChildren.push(new Table({
      rows: [new TableRow({
        height: { value: cm(5), rule: HeightRule.ATLEAST },
        cantSplit: true,
        children: [new TableCell({
          width: { size: cm(17), type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          borders: { top: line(8), bottom: line(8), left: line(8), right: line(8) },
          children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [run('评  语：', { size: 12 })] })],
        })],
      })],
      width: { size: cm(17), type: WidthType.DXA },
      columnWidths: [cm(17)],
      layout: TableLayoutType.FIXED,
      alignment: AlignmentType.CENTER,
      borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    }))
    bodyChildren.push(new Paragraph({ spacing: { before: 0, after: pt(6), line: 1, lineRule: LineRuleType.EXACT }, children: [run(' ', { size: 1 })] }))
  }
  await buildBody(bodyChildren)

  const page = {
    size: { width: mm(210), height: mm(297) },
    margin: {
      top: mm(25), bottom: mm(25), left: mm(20), right: mm(19),
      header: mm(12.7), footer: mm(12.7), gutter: mm(1),
    },
  }

  let header: Header | undefined
  let footer: Footer | undefined
  if (options.headerFooter && logos) {
    const headerFit = fitImage(logos.header, 159, 60)
    const courseTitle = (meta.course.trim() || '南京理工大学').replace(/^[“"]|[”"]$/g, '')
    const rawReportType = meta.reportType.trim()
    const headerSuffix = !rawReportType || rawReportType === '大作业' ? '课程报告' : rawReportType
    const headerText = `“${courseTitle}”${headerSuffix}`
    header = new Header({
      children: [new Table({
        rows: [new TableRow({
          children: [
            new TableCell({
              width: { size: cm(4.6), type: WidthType.DXA },
              borders: { top: NONE, left: NONE, right: NONE, bottom: line(6) },
              margins: { top: 0, bottom: 40, left: 0, right: 0 },
              children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 240, lineRule: LineRuleType.AUTO }, children: [imageRun(logos.header, headerFit.width, headerFit.height)] })],
            }),
            new TableCell({
              width: { size: cm(12.4), type: WidthType.DXA },
              verticalAlign: VerticalAlign.BOTTOM,
              borders: { top: NONE, left: NONE, right: NONE, bottom: line(6) },
              margins: { top: 0, bottom: 40, left: 0, right: 0 },
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { line: 240, lineRule: LineRuleType.AUTO }, children: [run(headerText, { size: 10.5 })] })],
            }),
          ],
        })],
        width: { size: cm(17), type: WidthType.DXA },
        columnWidths: [cm(4.6), cm(12.4)],
        layout: TableLayoutType.FIXED,
        borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
      })],
    })
    footer = new Footer({
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [
          run('第 ', { size: 10.5 }),
          new TextRun({ children: [PageNumber.CURRENT], size: 21, font: CN }),
          run(' 页 / 共 ', { size: 10.5 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES_IN_SECTION], size: 21, font: CN }),
          run(' 页', { size: 10.5 }),
        ],
      })],
    })
  }

  const sections: ISectionOptions[] = options.cover
    ? [
        { properties: { page }, children: coverChildren },
        {
          properties: { type: SectionType.NEXT_PAGE, page: { ...page, pageNumbers: { start: 1 } } },
          headers: header ? { default: header } : undefined,
          footers: footer ? { default: footer } : undefined,
          children: bodyChildren,
        },
      ]
    : [{
        properties: { page: { ...page, pageNumbers: { start: 1 } } },
        headers: header ? { default: header } : undefined,
        footers: footer ? { default: footer } : undefined,
        children: bodyChildren,
      }]

  const doc = new Document({
    creator: 'Kairos · NJUST 报告排版',
    title: meta.title || '课程报告',
    styles: {
      default: {
        document: {
          run: { font: CN, size: 24, color: '000000' },
          paragraph: { spacing: { line: 400, lineRule: LineRuleType.EXACT } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: CN, size: 32, bold: true, color: '000000' },
          paragraph: { spacing: { before: pt(12), after: pt(12), line: 240, lineRule: LineRuleType.AUTO }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: CN, size: 28, bold: true, color: '000000' },
          paragraph: { spacing: { before: pt(6), after: pt(6), line: 240, lineRule: LineRuleType.AUTO }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: HEI, size: 24, bold: true, color: '000000' },
          paragraph: { spacing: { before: 0, after: pt(6), line: 240, lineRule: LineRuleType.AUTO }, outlineLevel: 2 },
        },
        {
          id: 'TOC1',
          name: 'toc 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: CN, size: 24, bold: true, color: '000000' },
          paragraph: { spacing: { before: pt(4), after: pt(2), line: 320, lineRule: LineRuleType.AUTO } },
        },
        {
          id: 'TOC2',
          name: 'toc 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: CN, size: 24, color: '000000' },
          paragraph: { indent: { left: 240 }, spacing: { before: 0, after: pt(2), line: 320, lineRule: LineRuleType.AUTO } },
        },
        {
          id: 'TOC3',
          name: 'toc 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: CN, size: 21, color: '000000' },
          paragraph: { indent: { left: 480 }, spacing: { before: 0, after: pt(2), line: 300, lineRule: LineRuleType.AUTO } },
        },
      ],
    },
    features: { updateFields: true },
    sections,
  })
  const blob = await Packer.toBlob(doc)
  return { blob, warnings: [...new Set(warnings)] }
}
