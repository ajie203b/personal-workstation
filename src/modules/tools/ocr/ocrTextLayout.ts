import type { Quad } from './ocrDetection'

/** 格式化输出模式：智能排版 / 逐行原文 / Markdown 表格 */
export type OcrFormatMode = 'smart' | 'raw' | 'table'

/** 带文本的识别框（与 OcrLine 结构兼容） */
export interface TextBox {
  text: string
  box: Quad
  confidence?: number
}

interface BoxMetrics<T> {
  item: T
  quad: Quad
  x0: number
  y0: number
  x1: number
  y1: number
  cx: number
  cy: number
  width: number
  height: number
}

/** 四边形轴对齐包围盒与中心指标（阅读顺序与排版共用） */
function boxMetrics<T>(item: T, quad: Quad): BoxMetrics<T> {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return {
    item,
    quad,
    x0,
    y0,
    x1,
    y1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  }
}

function medianNum(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

interface RowCluster<T> {
  items: BoxMetrics<T>[]
  cy: number
  height: number
  y0: number
  y1: number
  x0: number
  x1: number
}

/** 将框按 y 坐标聚成 2D 视觉行，行内按 x 升序、行间按 y 升序 */
function clusterBoxRows<T>(boxes: BoxMetrics<T>[]): RowCluster<T>[] {
  const sorted = [...boxes].sort((a, b) => a.cy - b.cy)
  const rows: { items: BoxMetrics<T>[]; cy: number; height: number }[] = []
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(it.cy - r.cy) < 0.7 * Math.min(it.height, r.height))
    if (row) {
      row.items.push(it)
      row.cy = row.items.reduce((s, x) => s + x.cy, 0) / row.items.length
      row.height = row.items.reduce((s, x) => s + x.height, 0) / row.items.length
    } else {
      rows.push({ items: [it], cy: it.cy, height: it.height })
    }
  }
  rows.sort((a, b) => a.cy - b.cy)
  return rows.map((r) => {
    r.items.sort((a, b) => a.cx - b.cx)
    return {
      items: r.items,
      cy: r.cy,
      height: r.height,
      y0: Math.min(...r.items.map((x) => x.y0)),
      y1: Math.max(...r.items.map((x) => x.y1)),
      x0: Math.min(...r.items.map((x) => x.x0)),
      x1: Math.max(...r.items.map((x) => x.x1)),
    }
  })
}

function rowGaps<T>(rows: RowCluster<T>[]): number[] {
  const gaps: number[] = []
  for (let i = 1; i < rows.length; i++) {
    gaps.push(Math.max(0, rows[i].y0 - rows[i - 1].y1))
  }
  return gaps
}

/** 寻找可切分左右两栏的空白 X 通道（XY-cut X 分割） */
function findXCut<T>(boxes: BoxMetrics<T>[]): { left: BoxMetrics<T>[]; right: BoxMetrics<T>[] } | null {
  if (boxes.length < 4) return null
  const byX = [...boxes].sort((a, b) => a.x0 - b.x0)
  const medianH = medianNum(boxes.map((b) => b.height))
  const minGap = Math.max(20, 1.5 * medianH)

  let bestGap: { start: number; end: number; width: number } | null = null
  let curEnd = byX[0].x1
  for (let i = 1; i < byX.length; i++) {
    const gapW = byX[i].x0 - curEnd
    if (gapW >= minGap && (!bestGap || gapW > bestGap.width)) {
      bestGap = { start: curEnd, end: byX[i].x0, width: gapW }
    }
    if (byX[i].x1 > curEnd) curEnd = byX[i].x1
  }
  if (!bestGap) return null

  const cutX = (bestGap.start + bestGap.end) / 2
  const left = boxes.filter((b) => b.cx < cutX)
  const right = boxes.filter((b) => b.cx >= cutX)
  if (!left.length || !right.length) return null

  // 两栏必须在纵向上有交叠（否则只是上下错位）
  const leftMinY = Math.min(...left.map((b) => b.y0))
  const leftMaxY = Math.max(...left.map((b) => b.y1))
  const rightMinY = Math.min(...right.map((b) => b.y0))
  const rightMaxY = Math.max(...right.map((b) => b.y1))
  if (Math.min(leftMaxY, rightMaxY) - Math.max(leftMinY, rightMinY) <= 0) return null

  const leftRows = clusterBoxRows(left)
  const rightRows = clusterBoxRows(right)
  if (leftRows.length < 2 || rightRows.length < 2) return null

  // 少于 3 行的短列表/表格保持行优先，不误拆栏
  if (leftRows.length < 3 && rightRows.length < 3) return null

  // 若整块其实是 3 列及以上的对齐数据表（右侧还能再切出窄列且多数行同 y 对齐），保持行优先
  const combinedRows = clusterBoxRows(boxes)
  const multiCellRows = combinedRows.filter((r) => r.items.length >= 3)
  if (multiCellRows.length >= 2 && multiCellRows.length >= combinedRows.length * 0.5) return null

  const allRowGaps = [...rowGaps(leftRows), ...rowGaps(rightRows)]
  const medRowGap = medianNum(allRowGaps)
  if (bestGap.width <= medRowGap * 0.5 && leftRows.length < 4 && rightRows.length < 4) return null

  return { left, right }
}

/** 递归 XY-cut：先拆跨栏通栏标题/页脚，再拆左右多栏，返回从先到后排序的区域列表 */
function splitLayoutRegions<T>(boxes: BoxMetrics<T>[]): BoxMetrics<T>[][] {
  if (!boxes.length) return []
  const xCut = findXCut(boxes)
  if (xCut) {
    return [...splitLayoutRegions(xCut.left), ...splitLayoutRegions(xCut.right)]
  }

  // 若存在贯穿宽度的标题/页脚行挡住了全局 X 通道，先按通栏行切分段再检验是否出现可拆栏段
  const rows = clusterBoxRows(boxes)
  if (rows.length >= 3) {
    const minX = Math.min(...boxes.map((b) => b.x0))
    const maxX = Math.max(...boxes.map((b) => b.x1))
    const spanW = Math.max(1, maxX - minX)
    const sections: BoxMetrics<T>[][] = []
    let acc: BoxMetrics<T>[] = []
    for (const r of rows) {
      const hasSpanningBox = r.items.some((b) => b.width > spanW * 0.55)
      if (hasSpanningBox) {
        if (acc.length) {
          sections.push(acc)
          acc = []
        }
        sections.push(r.items)
      } else {
        acc.push(...r.items)
      }
    }
    if (acc.length) sections.push(acc)
    if (sections.length > 1 && sections.some((sec) => findXCut(sec) !== null)) {
      return sections.flatMap((sec) => splitLayoutRegions(sec))
    }
  }

  return [boxes]
}

/**
 * 阅读顺序排序：支持多栏截图（XY-cut 检测纵向栏隙，先读左栏再读右栏），
 * 单栏及表格按 y 分行（中心相差不超过较矮框的 70% 视为同行），行间按 y、行内按 x。
 */
export function sortByReadingOrder(quads: Quad[]): Quad[] {
  if (!quads.length) return []
  const boxes = quads.map((q) => boxMetrics(q, q))
  const regions = splitLayoutRegions(boxes)
  return regions.flatMap((region) =>
    clusterBoxRows(region).flatMap((row) => row.items.map((x) => x.quad)),
  )
}

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const CJK_PAIR_SPACE_RE = /([\u4e00-\u9fff\u3400-\u4dbf])[^\S\r\n]+([\u4e00-\u9fff\u3400-\u4dbf])/g
const SENTENCE_END_RE = /[。！？.!?：:；;」』）】\])]$/
const BULLET_START_RE = /^(?:[-•*·]|\d+[.、)])\s*/

/**
 * 清理中英文/数字混排与 OCR 误插空格：
 * 1. 去掉中文字符之间残留的单个误识空格（如「识 别」→「识别」）；
 * 2. 在中文与 ASCII 字母/数字边界补一个半角空格；
 * 3. 折叠多余空白。
 */
export function normalizeCjkSpacing(text: string): string {
  let out = text
  let prev = ''
  while (out !== prev) {
    prev = out
    out = out.replace(CJK_PAIR_SPACE_RE, '$1$2')
  }
  out = out
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff\u3400-\u4dbf])/g, '$1 $2')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim()
  return out
}

function joinSmartText(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  const lc = left[left.length - 1]
  const rc = right[0]
  if (CJK_CHAR_RE.test(lc) && CJK_CHAR_RE.test(rc)) return `${left}${right}`
  if ((CJK_CHAR_RE.test(lc) && /[A-Za-z0-9]/.test(rc)) || (/[A-Za-z0-9]/.test(lc) && CJK_CHAR_RE.test(rc))) {
    return `${left} ${right}`
  }
  if (CJK_CHAR_RE.test(lc) || CJK_CHAR_RE.test(rc)) return `${left}${right}`
  return `${left} ${right}`
}

function formatRegionSmart(boxes: BoxMetrics<TextBox>[]): string {
  const rows = clusterBoxRows(boxes)
  if (!rows.length) return ''
  const blockMinX = Math.min(...rows.map((r) => r.x0))
  const blockMaxX = Math.max(...rows.map((r) => r.x1))
  const medianH = Math.max(1, medianNum(rows.map((r) => r.height)))

  const rowOutputs = rows.map((row) => {
    let text = ''
    let hasWideGap = false
    for (let i = 0; i < row.items.length; i++) {
      const cellText = normalizeCjkSpacing(row.items[i].item.text)
      if (!cellText) continue
      if (!text) {
        text = cellText
        continue
      }
      const gap = row.items[i].x0 - row.items[i - 1].x1
      if (gap >= 1.5 * row.height) {
        hasWideGap = true
        text += `  ${cellText}`
      } else if (gap < 0.55 * row.height) {
        text = joinSmartText(text, cellText)
      } else {
        text += ` ${cellText}`
      }
    }
    return {
      text,
      x0: row.x0,
      x1: row.x1,
      y0: row.y0,
      y1: row.y1,
      h: row.height,
      tabular: hasWideGap || row.items.length > 2,
    }
  }).filter((r) => r.text.length > 0)

  if (!rowOutputs.length) return ''
  const paragraphs: string[] = [rowOutputs[0].text]
  for (let i = 1; i < rowOutputs.length; i++) {
    const prev = rowOutputs[i - 1]
    const cur = rowOutputs[i]
    const vGap = cur.y0 - prev.y1
    const canWrap =
      !prev.tabular &&
      !cur.tabular &&
      vGap <= 0.85 * Math.min(prev.h, cur.h) &&
      prev.x1 >= blockMaxX - 1.8 * prev.h &&
      !SENTENCE_END_RE.test(prev.text) &&
      cur.x0 <= blockMinX + 2.2 * cur.h &&
      !BULLET_START_RE.test(cur.text)

    if (canWrap) {
      paragraphs[paragraphs.length - 1] = joinSmartText(paragraphs[paragraphs.length - 1], cur.text)
    } else if (vGap > 1.15 * medianH) {
      paragraphs.push('', cur.text)
    } else {
      paragraphs.push(cur.text)
    }
  }
  return paragraphs.join('\n')
}

interface ColSlot {
  x0: number
  x1: number
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, '\\|').trim()
}

function formatMarkdownTable(boxes: BoxMetrics<TextBox>[]): string {
  const rows = clusterBoxRows(boxes)
  if (!rows.length) return ''

  const minX = Math.min(...boxes.map((b) => b.x0))
  const maxX = Math.max(...boxes.map((b) => b.x1))
  const totalW = Math.max(1, maxX - minX)

  // 从多单元格行或非全宽行归纳全局列槽，确保空单元格对齐
  const multiBoxes = rows.filter((r) => r.items.length >= 2).flatMap((r) => r.items)
  const slotSeed = (multiBoxes.length ? multiBoxes : boxes).slice().sort((a, b) => a.x0 - b.x0)
  const slots: ColSlot[] = []
  for (const b of slotSeed) {
    if (multiBoxes.length && b.width > totalW * 0.75) continue
    const match = slots.find((s) => Math.min(s.x1, b.x1) - Math.max(s.x0, b.x0) > 0)
    if (match) {
      match.x0 = Math.min(match.x0, b.x0)
      match.x1 = Math.max(match.x1, b.x1)
    } else {
      slots.push({ x0: b.x0, x1: b.x1 })
    }
  }
  slots.sort((a, b) => a.x0 - b.x0)

  if (slots.length <= 1) {
    const body = rows.map((r) => `| ${escapeMdCell(r.items.map((c) => normalizeCjkSpacing(c.item.text)).join(' '))} |`)
    return ['| 内容 |', '| --- |', ...body].join('\n')
  }

  const out: string[] = []
  const tableRows: string[][] = []
  const flushTable = () => {
    if (!tableRows.length) return
    out.push(`| ${tableRows[0].join(' | ')} |`)
    out.push(`| ${slots.map(() => '---').join(' | ')} |`)
    for (let i = 1; i < tableRows.length; i++) {
      out.push(`| ${tableRows[i].join(' | ')} |`)
    }
    tableRows.length = 0
  }

  for (const row of rows) {
    // 跨越多列的通栏标题行单独放表格外，避免把所有列宽挤歪
    if (row.items.length === 1 && row.items[0].width > totalW * 0.72 && tableRows.length === 0) {
      out.push(normalizeCjkSpacing(row.items[0].item.text))
      continue
    }
    const cells = new Array<string>(slots.length).fill('')
    for (const item of row.items) {
      let bestIdx = 0
      let bestScore = -Infinity
      for (let i = 0; i < slots.length; i++) {
        const overlap = Math.min(slots[i].x1, item.x1) - Math.max(slots[i].x0, item.x0)
        const dist = Math.abs((slots[i].x0 + slots[i].x1) / 2 - item.cx)
        const score = overlap > 0 ? overlap + 1000 : -dist
        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
      const txt = escapeMdCell(normalizeCjkSpacing(item.item.text))
      cells[bestIdx] = cells[bestIdx] ? `${cells[bestIdx]} ${txt}` : txt
    }
    tableRows.push(cells)
  }
  flushTable()
  return out.join('\n')
}

/**
 * 将 OCR 结果按指定排版模式整理为文本：
 * - `smart`：保留分栏与同行空格、自动合并自然段折行、清理中英间距；
 * - `table`：按 y 分行 + 全局列槽对齐输出 Markdown 表格；
 * - `raw`：按识别顺序逐框一行输出。
 */
export function formatOcrLines(lines: TextBox[], mode: OcrFormatMode = 'smart'): string {
  if (!lines.length) return ''
  if (mode === 'raw') return lines.map((l) => l.text).join('\n')
  const boxes = lines.map((l) => boxMetrics(l, l.box))
  if (mode === 'table') return formatMarkdownTable(boxes)
  const regions = splitLayoutRegions(boxes)
  return regions.map((reg) => formatRegionSmart(reg)).filter(Boolean).join('\n\n')
}
