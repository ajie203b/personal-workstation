/**
 * 排版打印（v3.3）：6 寸相纸（1800×1200 @300dpi，即 6×4 英寸横版）上摆证件照，
 * 带裁切线。布局计算是纯函数，画到 canvas 在页面里做。
 *
 * 一寸 295×413 → 4×2 共 8 张；二寸 413×579 → 2×2 共 4 张，与冲印店习惯一致。
 */

export interface SheetSpec {
  /** 相纸宽（px） */
  width: number
  /** 相纸高（px） */
  height: number
  /** 相纸 DPI */
  dpi: number
}

/** 6 寸横版：6×4 英寸 @300dpi */
export const SHEET_6IN: SheetSpec = { width: 1800, height: 1200, dpi: 300 }

export interface LayoutCell {
  x: number
  y: number
  width: number
  height: number
}

export interface SheetLayout {
  cols: number
  rows: number
  /** 格间距（px） */
  gap: number
  marginX: number
  marginY: number
  cells: LayoutCell[]
}

/** 格间空隙：留出裁切线的位置 */
export const SHEET_GAP = 16

/**
 * 选行列：cols×rows ≥ count 且放得进相纸，优先格子数刚好（浪费最少），
 * 平局时取整体形状更接近相纸比例的排布（二寸 4 张会选 2×2 而不是 4×1）。
 * 纸面放不下 count 张时自动降到能放的最大张数。
 */
export function pickGrid(
  count: number,
  photoW: number,
  photoH: number,
  sheet: SheetSpec,
  gap = SHEET_GAP,
): { cols: number; rows: number } {
  const colsMax = Math.max(1, Math.floor((sheet.width + gap) / (photoW + gap)))
  const rowsMax = Math.max(1, Math.floor((sheet.height + gap) / (photoH + gap)))
  const want = Math.max(1, Math.min(Math.round(count), colsMax * rowsMax))

  let best = { cols: 1, rows: 1, waste: Infinity, skew: Infinity }
  for (let cols = 1; cols <= colsMax; cols++) {
    const rows = Math.ceil(want / cols)
    if (rows > rowsMax) continue
    const w = cols * photoW + (cols - 1) * gap
    const h = rows * photoH + (rows - 1) * gap
    const waste = cols * rows - want
    const skew = Math.abs(w / h - sheet.width / sheet.height)
    if (waste < best.waste || (waste === best.waste && skew < best.skew)) {
      best = { cols, rows, waste, skew }
    }
  }
  return { cols: best.cols, rows: best.rows }
}

/** 排版布局：照片 1:1 原尺寸（与规格同像素，300dpi 一格一张），整组居中 */
export function computeSheetLayout(
  photo: { width: number; height: number },
  sheet: SheetSpec = SHEET_6IN,
  count = 4,
  gap = SHEET_GAP,
): SheetLayout {
  const n = Math.max(1, Math.round(count))
  const { cols, rows } = pickGrid(n, photo.width, photo.height, sheet, gap)
  const totalW = cols * photo.width + (cols - 1) * gap
  const totalH = rows * photo.height + (rows - 1) * gap
  const marginX = Math.round((sheet.width - totalW) / 2)
  const marginY = Math.round((sheet.height - totalH) / 2)

  const cells: LayoutCell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells.length >= n) break
      cells.push({
        x: marginX + c * (photo.width + gap),
        y: marginY + r * (photo.height + gap),
        width: photo.width,
        height: photo.height,
      })
    }
  }
  return { cols, rows, gap, marginX, marginY, cells }
}

/** 裁切线：每格四角向格外出的短刻线（长度取空隙的一半，上限 12px） */
export interface CutLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function cutLines(layout: SheetLayout): CutLine[] {
  const tick = Math.min(12, Math.max(4, Math.round(layout.gap / 2)))
  const lines: CutLine[] = []
  for (const cell of layout.cells) {
    const { x, y, width: w, height: h } = cell
    // 四角：水平 + 垂直各一条
    lines.push({ x1: x - tick, y1: y, x2: x, y2: y })
    lines.push({ x1: x, y1: y - tick, x2: x, y2: y })
    lines.push({ x1: x + w, y1: y, x2: x + w + tick, y2: y })
    lines.push({ x1: x + w, y1: y - tick, x2: x + w, y2: y })
    lines.push({ x1: x - tick, y1: y + h, x2: x, y2: y + h })
    lines.push({ x1: x, y1: y + h, x2: x, y2: y + h + tick })
    lines.push({ x1: x + w, y1: y + h, x2: x + w + tick, y2: y + h })
    lines.push({ x1: x + w, y1: y + h, x2: x + w, y2: y + h + tick })
  }
  return lines
}
