/**
 * 排版布局测试：6 寸相纸上的行列选择、居中、裁切线。
 */
import { describe, expect, it } from 'vitest'
import { SHEET_6IN, computeSheetLayout, cutLines, pickGrid } from './idphotoLayout'

describe('pickGrid', () => {
  it('一寸 295×413 × 8 → 4×2', () => {
    const g = pickGrid(8, 295, 413, SHEET_6IN)
    expect(g.cols).toBe(4)
    expect(g.rows).toBe(2)
  })

  it('二寸 413×579 × 4 → 2×2（不是 4×1）', () => {
    const g = pickGrid(4, 413, 579, SHEET_6IN)
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(2)
  })

  it('放不下的格数会自动降列（不越界）', () => {
    const g = pickGrid(12, 413, 579, SHEET_6IN)
    // 二寸在 6 寸纸上最多 2×2
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(4)
    const w = g.cols * 413 + (g.cols - 1) * 16
    const h = g.rows * 579 + (g.rows - 1) * 16
    expect(w).toBeLessThanOrEqual(SHEET_6IN.width)
    expect(h).toBeLessThanOrEqual(SHEET_6IN.height)
  })
})

describe('computeSheetLayout', () => {
  it('一寸 8 张：格子数 8、整组水平垂直居中', () => {
    const layout = computeSheetLayout({ width: 295, height: 413 }, SHEET_6IN, 8)
    expect(layout.cells).toHaveLength(8)
    const totalW = layout.cols * 295 + (layout.cols - 1) * layout.gap
    const totalH = layout.rows * 413 + (layout.rows - 1) * layout.gap
    expect(layout.marginX).toBe(Math.round((1800 - totalW) / 2))
    expect(layout.marginY).toBe(Math.round((1200 - totalH) / 2))
    // 所有格子都在纸内
    for (const c of layout.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.width).toBeLessThanOrEqual(1800)
      expect(c.y + c.height).toBeLessThanOrEqual(1200)
    }
  })

  it('同格不重叠，尺寸与照片 1:1', () => {
    const layout = computeSheetLayout({ width: 413, height: 579 }, SHEET_6IN, 4)
    expect(layout.cells).toHaveLength(4)
    for (const c of layout.cells) {
      expect(c.width).toBe(413)
      expect(c.height).toBe(579)
    }
    const a = layout.cells[0]
    const b = layout.cells[1]
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width)
  })
})

describe('cutLines', () => {
  it('每格 8 条裁切线，都在格子外沿', () => {
    const layout = computeSheetLayout({ width: 295, height: 413 }, SHEET_6IN, 8)
    const lines = cutLines(layout)
    expect(lines).toHaveLength(layout.cells.length * 8)
    const cell = layout.cells[0]
    for (const l of lines.slice(0, 8)) {
      const nearX = Math.abs(l.x1 - cell.x) <= 12 || Math.abs(l.x1 - (cell.x + cell.width)) <= 12
      const nearY = Math.abs(l.y1 - cell.y) <= 12 || Math.abs(l.y1 - (cell.y + cell.height)) <= 12
      expect(nearX || nearY).toBe(true)
    }
  })
})
