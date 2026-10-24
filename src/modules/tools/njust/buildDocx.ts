import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, HeightRule, ImageRun,
  LineRuleType, PageNumber, Packer, Paragraph, SectionType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, convertMillimetersToTwip,
  type FileChild, type ISectionOptions, type ParagraphChild,
} from 'docx'
import type { Block, BinaryImage, Inline, ReportLogos, ReportMeta, ReportOptions } from './types'
import { latexToMath, mathNode, renderFormulaPng } from './formula'

const mm = (n: number) => convertMillimetersToTwip(n)
const pt = (n: number) => Math.round(n * 20)
const cm = (n: number) => Math.round(n * 567)

const CN = { ascii: 'Times New Roman', eastAsia: '宋体', hAnsi: 'Times New Roman', cs: 'Times New Roman' }
const HEI = { ...CN, eastAsia: '黑体' }
const FS = { ...CN, eastAsia: '仿宋' }
const CODE = { ascii: 'Consolas', eastAsia: '宋体', hAnsi: 'Consolas', cs: 'Consolas' }

const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const line = (size: number) => ({ style: BorderStyle.SINGLE, size, color: '000000' })

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

async function blobToImage(blob: Blob): Promise<BinaryImage> {
  const data = new Uint8Array(await blob.arrayBuffer())
  if (blob.type.includes('svg')) throw new Error('SVG 图片暂不支持，请导出为 PNG 后重试')
  const type = blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg'
    : blob.type.includes('gif') ? 'gif'
      : blob.type.includes('bmp') ? 'bmp' : 'png'
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(blob)
    : await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')) }
        img.src = url
      })
  return { data, type, width: bitmap.width, height: bitmap.height }
}

async function dataUrlImage(src: string): Promise<BinaryImage | null> {
  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,([\s\S]+)$/i.exec(src)
  if (!match) return null
  const mime = match[1].toLowerCase()
  const binary = atob(match[2])
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
  const type = mime === 'jpeg' || mime === 'jpg' ? 'jpg' : mime === 'gif' ? 'gif' : mime === 'bmp' ? 'bmp' : 'png'
  const blob = new Blob([data], { type: mime === 'jpg' || mime === 'jpeg' ? 'image/jpeg' : `image/${mime}` })
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(blob)
    : await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')) }
        img.src = url
      })
  return { data, type, width: bitmap.width, height: bitmap.height }
}

function fitImage(img: BinaryImage, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / img.width, maxH / img.height)
  return { width: Math.max(24, Math.round(img.width * scale)), height: Math.max(16, Math.round(img.height * scale)) }
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

function cnNo(n: number): string {
  const nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (n <= 10) return nums[n - 1] ?? String(n)
  if (n < 20) return `十${nums[n - 11] ?? ''}`
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
  logos: ReportLogos
  warnings?: string[]
}

export async function buildReport(input: BuildInput): Promise<{ blob: Blob; warnings: string[] }> {
  const { meta, options, logos } = input
  const blocks = input.blocks
  const warnings = [...(input.warnings ?? [])]
  const formulaCache = new Map<string, BinaryImage | null>()

  const formulaImage = async (latex: string, display: boolean) => {
    const key = `${display ? 'd' : 'i'}:${latex}`
    if (!formulaCache.has(key)) formulaCache.set(key, await renderFormulaPng(latex, display))
    return formulaCache.get(key) ?? null
  }

  const inlineChildren = async (inlines: Inline[], size = 12, baseBold = false, baseItalic = false, baseStrike = false): Promise<ParagraphChild[]> => {
    const children: ParagraphChild[] = []
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
          children.push(mathNode(comps))
        } else {
          const img = await formulaImage(item.latex, false)
          if (img) {
            const scale = 0.82
            const fit = fitImage(img, 300, 72)
            children.push(imageRun(img, fit.width * scale, fit.height * scale))
          } else {
            warnings.push(`行内公式未能转换：${item.latex.slice(0, 60)}`)
            children.push(run(`$${item.latex}$`, { size, italic: true }))
          }
        }
      }
    }
    return children
  }

  const bodyParagraph = async (inlines: Inline[], opts: { quote?: boolean; noIndent?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) => {
    const children = await inlineChildren(inlines)
    return new Paragraph({
      alignment: opts.align ?? AlignmentType.BOTH,
      spacing: { before: 0, after: 0, line: 400, lineRule: LineRuleType.EXACT },
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

  const buildTable = (block: Extract<Block, { type: 'table' }>, chapter: number, seq: number, fallbackTitle: string): FileChild[] => {
    const cols = Math.max(1, block.headers.length)
    const rows = [block.headers, ...block.rows].map((r) => {
      const row = r.slice(0, cols)
      while (row.length < cols) row.push('')
      return row
    })
    const weights = Array.from({ length: cols }, (_, i) => {
      const maxLen = Math.max(4, ...rows.map((r) => (r[i] ?? '').length))
      return Math.min(26, maxLen)
    })
    const sum = weights.reduce((a, b) => a + b, 0) || 1
    let widths = weights.map((w) => Math.max(2.0, (17 * w) / sum))
    const wSum = widths.reduce((a, b) => a + b, 0)
    widths = widths.map((w) => (w * 17) / wSum)

    const tableRows = rows.map((cells, rowIndex) => {
      const isHeader = rowIndex === 0
      const isLast = rowIndex === rows.length - 1
      return new TableRow({
        cantSplit: true,
        tableHeader: isHeader,
        height: { value: cm(0.62), rule: HeightRule.ATLEAST },
        children: cells.map((cell, i) => new TableCell({
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
            children: [run(cell, { size: 10.5, bold: isHeader })],
          })],
        })),
      })
    })

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
        for (let i = 0; i < block.items.length; i++) {
          const c = await inlineChildren([{ type: 'text', text: block.ordered ? `${i + 1}. ` : '· ' }, ...block.items[i]])
          children.push(new Paragraph({
            alignment: AlignmentType.BOTH,
            spacing: { before: 0, after: 0, line: 400, lineRule: LineRuleType.EXACT },
            indent: { left: 480, hanging: 240 },
            children: c,
          }))
        }
      } else if (block.type === 'code') {
        const lines = block.text.replace(/\r/g, '').split('\n')
        lines.forEach((ln, i) => {
          children.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: i === 0 ? pt(4) : 0, after: i === lines.length - 1 ? pt(6) : 0, line: pt(13), lineRule: LineRuleType.EXACT },
            indent: { left: pt(14) },
            keepNext: i < lines.length - 1,
            children: [run(ln || ' ', { size: 9, font: CODE, shade: 'F5F5F5' })],
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
        children.push(...buildTable(block, Math.max(1, chapter), tableSeq, currentHeading))
      }
    }
  }

  const coverChildren: FileChild[] = []
  if (options.cover) {
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
  bodyChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: pt(16), after: pt(16), line: 240, lineRule: LineRuleType.AUTO },
    children: [run(meta.title.trim() || '课程报告', { size: 22, bold: true })],
  }))
  bodyChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: pt(6), after: pt(6), line: 240, lineRule: LineRuleType.AUTO },
    children: [run(`学号：${meta.studentId}    姓名：${meta.name}`, { size: 12 })],
  }))
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
  if (options.headerFooter) {
    const headerFit = fitImage(logos.header, 159, 60)
    const headerText = `“${(meta.course.trim() || '南京理工大学').replace(/^[“"]|[”"]$/g, '')}”课程报告`
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
    },
    features: { updateFields: true },
    sections,
  })
  const blob = await Packer.toBlob(doc)
  return { blob, warnings: [...new Set(warnings)] }
}
