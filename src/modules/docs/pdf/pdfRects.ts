export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PdfSelectionInfo {
  text: string
  page: number
  rects: NormRect[]
  /** 浮条锚点（容器坐标）：below=true 表示应显示在选区下方 */
  popover: { left: number; y: number; below: boolean }
}

/**
 * 按行并块。pdf.js 文本层同一行会因字体切换产出互相覆盖的 span（整行一段，拉丁词与标点又单独成段），
 * Range.getClientRects() 因此拿到重叠矩形：半透明底色叠两处深浅不一，标点单独成段处还断开。
 * 规则：垂直重叠过半算同一行；同行内水平间隙小于 0.9 倍行高的并成一块——够吞下词间空格，不至于跨过双栏栏距。
 * aspect = 页高 / 页宽，把行高换算到与 x 同一量纲。
 */
export function mergeLineRects(rects: NormRect[], aspect: number): NormRect[] {
  const out: NormRect[] = []
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let hit: NormRect | null = null
    let hitGap = Infinity
    for (const m of out) {
      const overlapY = Math.min(m.y + m.h, r.y + r.h) - Math.max(m.y, r.y)
      if (overlapY < Math.min(m.h, r.h) * 0.5) continue
      const gap = Math.max(m.x, r.x) - Math.min(m.x + m.w, r.x + r.w)
      if (gap < hitGap) {
        hitGap = gap
        hit = m
      }
    }
    if (hit && hitGap <= Math.max(hit.h, r.h) * aspect * 0.9) {
      const x = Math.min(hit.x, r.x)
      const y = Math.min(hit.y, r.y)
      const right = Math.max(hit.x + hit.w, r.x + r.w)
      const bottom = Math.max(hit.y + hit.h, r.y + r.h)
      hit.x = x
      hit.y = y
      hit.w = right - x
      hit.h = bottom - y
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** 选区 Range → 页内归一化并块矩形（wRect 为该页 wrapper 的矩形，换算成页的百分比） */
export function collectPageRects(range: Range, wRect: DOMRect): NormRect[] {
  return mergeLineRects(
    Array.from(range.getClientRects())
      .map((r) => ({
        x: (r.left - wRect.left) / wRect.width,
        y: (r.top - wRect.top) / wRect.height,
        w: r.width / wRect.width,
        h: r.height / wRect.height,
      }))
      .filter((r) => r.w > 0.001 && r.h > 0.001),
    wRect.height / wRect.width,
  )
}

/** 提取页面划词信息（桌面 mouseup 与移动端 selectionchange 共用） */
export function readPageSelection(
  page: number,
  wrapper: HTMLElement,
  container: HTMLElement | null,
): PdfSelectionInfo | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !container) return null
  const text = sel.toString().trim()
  if (!text) return null
  const range = sel.getRangeAt(0)
  const wRect = wrapper.getBoundingClientRect()
  const rects = collectPageRects(range, wRect)
  if (!rects.length) return null
  const last = rects[rects.length - 1]
  const firstTop = rects[0].y * wRect.height + wRect.top
  const lastBottom = (last.y + last.h) * wRect.height + wRect.top
  const below = firstTop < 90
  return {
    text,
    page,
    rects,
    popover: {
      left: (last.x + last.w / 2) * wRect.width + wRect.left,
      y: below ? lastBottom : firstTop,
      below,
    },
  }
}

/** 从渲染画布裁剪区域截图（M2.5） */
export function cropPdfCanvas(
  wrapper: HTMLElement,
  rect: { x: number; y: number; w: number; h: number },
): string | null {
  const canvas = wrapper.querySelector('canvas')
  if (!canvas) return null
  const sx = rect.x * canvas.width
  const sy = rect.y * canvas.height
  const sw = Math.max(2, rect.w * canvas.width)
  const sh = Math.max(2, rect.h * canvas.height)
  const outW = Math.min(1200, Math.round(sw))
  const outH = Math.max(2, Math.round(sh * (outW / sw)))
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH)
  try {
    return out.toDataURL('image/jpeg', 0.88)
  } catch {
    return null
  }
}
