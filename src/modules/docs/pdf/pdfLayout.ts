export const PDF_TRIM_SCALE = 1.14
export const PDF_SPREAD_MIN_WIDTH = 960
export const PDF_SPREAD_COL_GAP = 12
export const PDF_ROW_GAP = 16

export interface PdfLayoutRow {
  pages: number[]
  y: number
  height: number
}

export interface PdfLayoutMetrics {
  rows: PdfLayoutRow[]
  /** 0-indexed page offsets (`pageOffsets[p - 1] = row.y`) */
  pageOffsets: number[]
  rowIndexOfPage: number[]
  totalHeight: number
}

export function canUsePdfSpread(
  pdfSpread: boolean | undefined,
  containerW: number,
  phoneLayout: boolean,
): boolean {
  return Boolean(pdfSpread && !phoneLayout && containerW >= PDF_SPREAD_MIN_WIDTH)
}

export function computePdfFitWidth(
  containerW: number,
  phoneLayout: boolean,
  widthPct: number | undefined,
  spreadActive: boolean,
): number {
  const widthRatio = phoneLayout ? 1 : Math.min(1, Math.max(0.5, (widthPct ?? 90) / 100))
  if (!spreadActive) return Math.max(180, (containerW - 24) * widthRatio)
  return Math.max(180, ((containerW - 36 - PDF_SPREAD_COL_GAP) / 2) * widthRatio)
}

export function computePdfDisplayWidth(fitW: number, zoom: number): number {
  return Math.max(180, Math.min(Math.round(fitW * zoom), 2600))
}

export function computePdfRenderDpr(dispW: number, baseDpr: number): number {
  return Math.max(1, Math.min(baseDpr, 3000 / Math.max(1, dispW)))
}

export function buildPdfRows(numPages: number, spreadActive: boolean): number[][] {
  if (numPages <= 0) return []
  if (!spreadActive) return Array.from({ length: numPages }, (_, i) => [i + 1])
  const rows: number[][] = []
  for (let p = 1; p <= numPages; p += 2) {
    rows.push(p + 1 <= numPages ? [p, p + 1] : [p])
  }
  return rows
}

export function computePdfLayout(
  numPages: number,
  ratios: readonly number[],
  dispW: number,
  spreadActive: boolean,
  gap = PDF_ROW_GAP,
): PdfLayoutMetrics {
  const rowPages = buildPdfRows(numPages, spreadActive)
  const rows: PdfLayoutRow[] = []
  const pageOffsets = new Array<number>(Math.max(0, numPages)).fill(0)
  const rowIndexOfPage = new Array<number>(Math.max(0, numPages)).fill(0)
  const pageH = (idx: number) => (ratios[idx] ? Math.round(dispW * ratios[idx]) : Math.round(dispW * 1.414))

  let acc = 0
  rowPages.forEach((pages, rowIdx) => {
    let height = 0
    for (const p of pages) {
      height = Math.max(height, pageH(p - 1))
      pageOffsets[p - 1] = acc
      rowIndexOfPage[p - 1] = rowIdx
    }
    rows.push({ pages, y: acc, height })
    acc += height + gap
  })

  return { rows, pageOffsets, rowIndexOfPage, totalHeight: acc }
}

export function findRowAtY(rows: readonly PdfLayoutRow[], y: number): number {
  if (!rows.length) return 0
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (rows[mid].y <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function computeTrimTransform(trimmed: boolean, previewScale: number): {
  trimTransform: string | undefined
  previewTransform: string | undefined
} {
  return {
    trimTransform: trimmed ? `scale(${PDF_TRIM_SCALE})` : undefined,
    previewTransform: Math.abs(previewScale - 1) > 0.005 ? `scale(${previewScale})` : undefined,
  }
}
