/**
 * 本地 OCR 纯函数管线（v3.3）：预处理 / DB 检测后处理 / 阅读顺序排序 / CTC 解码。
 *
 * 全部是纯函数（不碰 DOM / 网络 / ONNX），可直接单测：
 * - computeDetSize：检测输入尺寸（最长边约 960、32 的倍数、保持比例）
 * - boxesFromProbMap：DB 后处理（二值化 → 连通域 → 最小外接矩形 → 打分 → unclip 扩框）
 * - sortByReadingOrder：按 y 分行、行内按 x
 * - ctcGreedyDecode：CTC 贪心解码查字典
 *
 * 预处理参数取自 PaddleOCR 官方配置（configs/det/det_mv3_db.yml、
 * configs/rec/PP-OCRv3/ch_PP-OCRv3_rec.yml）：
 * - det：BGR 通道序，(x/255 - mean)/std，mean=[0.485,0.456,0.406]，std=[0.229,0.224,0.225]
 * - rec：BGR 通道序，(x/255 - 0.5)/0.5
 */

/** 点（图像像素坐标） */
export interface Point {
  x: number
  y: number
}

/** 四边形，顺序：左上、右上、右下、左下 */
export type Quad = [Point, Point, Point, Point]

/** 检测输入最长边（约值，会再取整到 32 的倍数） */
export const DET_MAX_SIDE = 960
/** 识别输入高度（PP-OCR rec 固定 48） */
export const REC_IMG_HEIGHT = 48
/**
 * 识别输入宽度上限。PP-OCRv4 rec 是动态宽度（官方推理按 max_wh_ratio 放宽，
 * 不硬卡 320）；卡 320 会把一整行长文字压扁到字符挤成一团。
 * 取 48×40=1920：手机截图一整行中文（宽高比 ~25）也不会被压缩。
 */
export const REC_IMG_MAX_WIDTH = 1920
/** 低于此置信度在界面上标黄 */
export const LOW_CONFIDENCE = 0.75

/** DB 后处理参数（对齐 PaddleOCR det_db_* 默认值） */
export interface DbPostOptions {
  /** 概率图二值化阈值 det_db_thresh */
  binThresh: number
  /** 框打分阈值 det_db_box_thresh，低于它的框丢弃 */
  boxThresh: number
  /** 扩框比例 det_db_unclip_ratio */
  unclipRatio: number
  /** 最小边长（像素），过小的框当噪点丢弃 */
  minBoxSide: number
  /** 最多保留的候选连通域数 */
  maxCandidates: number
}

export const DEFAULT_DB_OPTIONS: DbPostOptions = {
  binThresh: 0.3,
  boxThresh: 0.6,
  unclipRatio: 1.5,
  minBoxSide: 3,
  maxCandidates: 1000,
}

/** 四个角按 左上、右上、右下、左下 排序（用 x+y / x-y 的极值点判定） */
export function orderQuad(points: Point[]): Quad {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y))
  const tl = bySum[0]
  const br = bySum[bySum.length - 1]
  const byDiff = [...points].sort((a, b) => a.x - a.y - (b.x - b.y))
  const bl = byDiff[0]
  const tr = byDiff[byDiff.length - 1]
  return [tl, tr, br, bl]
}

/**
 * 检测输入尺寸：等比缩到最长边约 maxSide，宽高都取 32 的倍数（DB 网络要求）。
 * 小图不放大，但最小 32。
 */
export function computeDetSize(
  width: number,
  height: number,
  maxSide = DET_MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1))
  const snap = (v: number) => Math.max(32, Math.round((v * scale) / 32) * 32)
  return { width: snap(width), height: snap(height) }
}

/** 检测时短边的上限（缩放后）：手机截图 1080 宽 → 960，字高保留约 90% */
export const DET_SHORT_SIDE = 960
/** 单块检测允许的最长边（缩放后）；超过就沿长边切块 */
export const DET_TILE_MAX = 2048
/** 切块时每块长边（缩放后）与相邻块重叠（缩放后，需大于一行字的高度） */
export const DET_TILE_LEN = 1536
export const DET_TILE_OVERLAP = 192

/** 一块检测区域：源图里的矩形 + 送进 det 网络的尺寸（32 的倍数） */
export interface DetTile {
  /** 源图坐标系 */
  x: number
  y: number
  width: number
  height: number
  /** 送 det 的尺寸 */
  detWidth: number
  detHeight: number
}

/**
 * 检测切块规划（v3.3.3）。
 *
 * 旧逻辑把「最长边」压到 960：1080×2400 的截图会被压成 432×960，
 * 正文字高只剩 7~8px，DB 网络基本看不见字；长截图（1080×8000）更是压成一条线。
 * 现在改成：
 * - 先按「短边 ≤ 960」等比缩（小图不放大）；
 * - 缩完长边 ≤ 2048 就整张一块；
 * - 再长就沿长边切成 1536 一块、相邻重叠 192 的条带，逐块检测再合并（dedupeQuads）。
 */
export function planDetTiles(
  width: number,
  height: number,
  opts: { shortSide?: number; tileMax?: number; tileLen?: number; overlap?: number } = {},
): DetTile[] {
  const shortSide = opts.shortSide ?? DET_SHORT_SIDE
  const tileMax = opts.tileMax ?? DET_TILE_MAX
  const tileLen = opts.tileLen ?? DET_TILE_LEN
  const overlap = opts.overlap ?? DET_TILE_OVERLAP
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const scale = Math.min(1, shortSide / Math.min(w, h))
  const snap = (v: number) => Math.max(32, Math.round(v / 32) * 32)
  const tall = h >= w
  const longSrc = tall ? h : w
  const shortSrc = tall ? w : h
  const longScaled = longSrc * scale
  const mk = (start: number, len: number): DetTile => {
    const detShort = snap(shortSrc * scale)
    const detLong = snap(len * scale)
    return tall
      ? { x: 0, y: start, width: w, height: len, detWidth: detShort, detHeight: detLong }
      : { x: start, y: 0, width: len, height: h, detWidth: detLong, detHeight: detShort }
  }
  if (longScaled <= tileMax) return [mk(0, longSrc)]
  const lenSrc = tileLen / scale
  const stepSrc = (tileLen - overlap) / scale
  const tiles: DetTile[] = []
  for (let start = 0; ; start += stepSrc) {
    const s0 = Math.round(start)
    if (s0 + lenSrc >= longSrc) {
      // 最后一块贴齐末端，保证长度一致
      tiles.push(mk(Math.max(0, Math.round(longSrc - lenSrc)), Math.min(longSrc, Math.round(lenSrc))))
      break
    }
    tiles.push(mk(s0, Math.round(lenSrc)))
  }
  return tiles
}

/** 四边形的轴对齐包围盒 */
function quadBounds(q: Quad): { x0: number; y0: number; x1: number; y1: number } {
  const xs = q.map((p) => p.x)
  const ys = q.map((p) => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/**
 * 切块重叠区的去重：两个框的交集占较小框面积 ≥ containRatio 时，只留大的
 * （被块边界截断的半行，会被下一块里完整的那一行盖住）。
 */
export function dedupeQuads(quads: Quad[], containRatio = 0.6): Quad[] {
  const items = quads
    .map((q) => {
      const b = quadBounds(q)
      return { q, b, area: Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) }
    })
    .sort((a, b) => b.area - a.area)
  const kept: typeof items = []
  for (const it of items) {
    const dup = kept.some((k) => {
      const ix = Math.min(k.b.x1, it.b.x1) - Math.max(k.b.x0, it.b.x0)
      const iy = Math.min(k.b.y1, it.b.y1) - Math.max(k.b.y0, it.b.y0)
      if (ix <= 0 || iy <= 0) return false
      return (ix * iy) / Math.max(1e-6, Math.min(it.area, k.area)) >= containRatio
    })
    if (!dup) kept.push(it)
  }
  return kept.map((k) => k.q)
}

/** 从 RGBA 里裁出一个矩形（整数坐标） */
export function cropRgba(
  src: Uint8ClampedArray,
  sw: number,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * sw + x) * 4
    out.set(src.subarray(s, s + w * 4), row * w * 4)
  }
  return out
}

/** 双线性缩放 RGBA 像素（纯 TypedArray 实现，Worker 里不需要 canvas） */
export function resizeRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yr - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xr - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        out[o + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}

/**
 * RGBA → CHW 归一化张量（BGR 通道序，即平面 0=B、1=G、2=R）。
 * det / rec 都吃 BGR，差别只在 mean/std。
 */
export function rgbaToChwTensor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mean: [number, number, number],
  std: [number, number, number],
): Float32Array {
  const plane = width * height
  const out = new Float32Array(3 * plane)
  const b = plane
  const g = plane * 2
  for (let i = 0; i < plane; i++) {
    const s = i * 4
    out[i] = (rgba[s + 2] / 255 - mean[0]) / std[0] // B
    out[b + i] = (rgba[s + 1] / 255 - mean[1]) / std[1] // G
    out[g + i] = (rgba[s] / 255 - mean[2]) / std[2] // R
  }
  return out
}

/** det 归一化：ImageNet 统计（PaddleOCR det 配置） */
export function toDetTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  return rgbaToChwTensor(rgba, width, height, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
}

/** rec 归一化：(x/255 - 0.5) / 0.5（PaddleOCR rec 配置） */
export function toRecTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  return rgbaToChwTensor(rgba, width, height, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
}

/** 概率图二值化：prob > thresh 记 1 */
export function binarize(prob: Float32Array, thresh: number): Uint8Array {
  const out = new Uint8Array(prob.length)
  for (let i = 0; i < prob.length; i++) out[i] = prob[i] > thresh ? 1 : 0
  return out
}

/** 8 邻域连通域标记，返回每个连通域的像素下标列表 */
export function connectedComponents(bitmap: Uint8Array, width: number, height: number, maxCount: number): Int32Array[] {
  const n = width * height
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  const comps: Int32Array[] = []
  for (let i = 0; i < n && comps.length < maxCount; i++) {
    if (!bitmap[i] || visited[i]) continue
    let sp = 0
    stack[sp++] = i
    visited[i] = 1
    const pts: number[] = []
    while (sp > 0) {
      const p = stack[--sp]
      pts.push(p)
      const px = p % width
      const py = (p / width) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const idx = ny * width + nx
          if (bitmap[idx] && !visited[idx]) {
            visited[idx] = 1
            stack[sp++] = idx
          }
        }
      }
    }
    comps.push(Int32Array.from(pts))
  }
  return comps
}

/** 二维凸包（Andrew 单调链），点数 ≤ 2 时原样返回 */
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 2) return points.slice()
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

interface Rect {
  quad: Quad
  width: number
  height: number
}

/** 凸包的最小外接矩形（按每条边方向做旋转包围盒取面积最小） */
export function minAreaRect(hull: Point[]): Rect | null {
  if (hull.length === 0) return null
  if (hull.length === 1) {
    const p = hull[0]
    return { quad: orderQuad([{ x: p.x - 0.5, y: p.y - 0.5 }, { x: p.x + 0.5, y: p.y - 0.5 }, { x: p.x + 0.5, y: p.y + 0.5 }, { x: p.x - 0.5, y: p.y + 0.5 }]), width: 1, height: 1 }
  }
  if (hull.length === 2) {
    const [a, b] = hull
    return {
      quad: orderQuad([
        { x: a.x - 0.5, y: a.y - 0.5 },
        { x: b.x + 0.5, y: a.y - 0.5 },
        { x: b.x + 0.5, y: b.y + 0.5 },
        { x: a.x - 0.5, y: b.y + 0.5 },
      ]),
      width: Math.abs(b.x - a.x) + 1,
      height: Math.abs(b.y - a.y) + 1,
    }
  }
  let best: { area: number; uMin: number; vMin: number; uSize: number; vSize: number; ax: number; ay: number; ux: number; uy: number } | null = null
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const len = Math.hypot(ex, ey) || 1
    const ux = ex / len
    const uy = ey / len
    let uMin = Infinity
    let uMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    for (const p of hull) {
      const u = (p.x - a.x) * ux + (p.y - a.y) * uy
      const v = -(p.x - a.x) * uy + (p.y - a.y) * ux
      if (u < uMin) uMin = u
      if (u > uMax) uMax = u
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
    const area = (uMax - uMin) * (vMax - vMin)
    if (!best || area < best.area) {
      best = { area, uMin, vMin, uSize: uMax - uMin, vSize: vMax - vMin, ax: a.x, ay: a.y, ux, uy }
    }
  }
  if (!best) return null
  const at = (u: number, v: number): Point => ({
    x: best.ax + u * best.ux - v * best.uy,
    y: best.ay + u * best.uy + v * best.ux,
  })
  const { uMin, vMin, uSize, vSize } = best
  return {
    quad: orderQuad([at(uMin, vMin), at(uMin + uSize, vMin), at(uMin + uSize, vMin + vSize), at(uMin, vMin + vSize)]),
    width: uSize,
    height: vSize,
  }
}

/** 点是否在凸四边形内（同侧判定） */
export function pointInQuad(px: number, py: number, quad: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** 框内概率均值（DB 的 box_score_fast） */
export function quadScore(prob: Float32Array, width: number, height: number, quad: Quad): number {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)))
  let sum = 0
  let count = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!pointInQuad(x + 0.5, y + 0.5, quad)) continue
      sum += prob[y * width + x]
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

/** 矩形四边形向外扩 distance（沿两条轴各推 distance，等价 pyclipper 对矩形的 miter offset） */
export function expandRect(quad: Quad, distance: number): Quad {
  const [tl, tr, br, bl] = quad
  const cx = (tl.x + tr.x + br.x + bl.x) / 4
  const cy = (tl.y + tr.y + br.y + bl.y) / 4
  const ulen = Math.hypot(tr.x - tl.x, tr.y - tl.y) || 1
  const vlen = Math.hypot(bl.x - tl.x, bl.y - tl.y) || 1
  const ux = (tr.x - tl.x) / ulen
  const uy = (tr.y - tl.y) / ulen
  const vx = (bl.x - tl.x) / vlen
  const vy = (bl.y - tl.y) / vlen
  const hw = ulen / 2 + distance
  const hh = vlen / 2 + distance
  const corner = (su: number, sv: number): Point => ({ x: cx + su * hw * ux + sv * hh * vx, y: cy + su * hw * uy + sv * hh * vy })
  return orderQuad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)])
}

/**
 * DB 概率图 → 文本框四边形列表：
 * 二值化 → 连通域 → 最小外接矩形 → 框内均值打分 → unclip 扩框 → 过滤过小框。
 * 纯函数，合成概率图即可测。
 */
export function boxesFromProbMap(
  prob: Float32Array,
  width: number,
  height: number,
  options: Partial<DbPostOptions> = {},
): Quad[] {
  const opts = { ...DEFAULT_DB_OPTIONS, ...options }
  const bitmap = binarize(prob, opts.binThresh)
  const comps = connectedComponents(bitmap, width, height, opts.maxCandidates)
  const quads: Quad[] = []
  for (const comp of comps) {
    if (comp.length < opts.minBoxSide) continue
    // 超大连通域降采样，凸包只依赖极值点
    const stride = comp.length > 20000 ? Math.ceil(comp.length / 20000) : 1
    const pts: Point[] = []
    for (let i = 0; i < comp.length; i += stride) {
      const p = comp[i]
      pts.push({ x: p % width, y: (p / width) | 0 })
    }
    const rect = minAreaRect(convexHull(pts))
    if (!rect) continue
    if (Math.min(rect.width, rect.height) < opts.minBoxSide) continue
    const score = quadScore(prob, width, height, rect.quad)
    if (score < opts.boxThresh) continue
    // unclip：周长反推外扩距离，面积越大扩得越多
    const perimeter = 2 * (rect.width + rect.height)
    const distance = perimeter > 0 ? ((rect.width * rect.height) * opts.unclipRatio) / perimeter : 0
    const expanded = expandRect(rect.quad, distance)
    quads.push(expanded)
  }
  return quads
}

/** 四边形中心 / 高度（阅读顺序分组用） */
function quadMetrics(quad: Quad): { cx: number; cy: number; height: number } {
  const ys = quad.map((p) => p.y)
  const xs = quad.map((p) => p.x)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (top + bottom) / 2, height: Math.max(1, bottom - top) }
}

/**
 * 阅读顺序排序：按 y 分行（行内垂直中心相差不超过较矮框的 70% 视为同行），
 * 行间按 y，行内按 x。
 */
export function sortByReadingOrder(quads: Quad[]): Quad[] {
  const items = quads.map((quad) => ({ quad, ...quadMetrics(quad) }))
  items.sort((a, b) => a.cy - b.cy)
  const rows: { items: typeof items; cy: number; height: number }[] = []
  for (const it of items) {
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
  return rows.flatMap((r) => {
    r.items.sort((a, b) => a.cx - b.cx)
    return r.items.map((x) => x.quad)
  })
}

/** 求 3x3 单应矩阵（把目标矩形四角映射到源四边形），返回 8 个自由参数 */
function solveHomography(dst: Point[], src: Point[]): number[] | null {
  // 8x9 增广矩阵，未知数 [h0..h7]（h8 = 1）
  const m: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]
    const { x, y } = src[i]
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    if (Math.abs(m[pivot][col]) < 1e-9) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    const d = m[col][col]
    for (let k = col; k < 9; k++) m[col][k] /= d
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (f === 0) continue
      for (let k = col; k < 9; k++) m[r][k] -= f * m[col][k]
    }
  }
  return m.map((row) => row[8])
}

/**
 * 透视（单应）裁剪：把四边形区域拉正成 dw×dh 的 RGBA 图。
 * 目标矩形四角对应 quad 的 左上/右上/右下/左下，双线性采样。
 */
export function warpQuadRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  quad: Quad,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4)
  // 注意方向：solveHomography(dst, src) 求的是「目标坐标 → 源坐标」的映射，
  // 这里要的是「输出条带像素 (u,v) → 源图像素」，所以 dst 是输出矩形、src 是检测框。
  // v3.3.0~3.3.2 把两者传反了：采样点全落在图外，条带整片 128 灰，识别永远是空串
  // →「没有识别到文字」。
  const h = solveHomography(
    [
      { x: 0, y: 0 },
      { x: dw, y: 0 },
      { x: dw, y: dh },
      { x: 0, y: dh },
    ],
    [quad[0], quad[1], quad[2], quad[3]],
  )
  if (!h) {
    // 退化四边形（四点共线等）：直接返回中性灰，避免整条管线失败
    out.fill(128)
    return out
  }
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const u = x + 0.5
      const v = y + 0.5
      const denom = h[6] * u + h[7] * v + 1
      const sx = (h[0] * u + h[1] * v + h[2]) / denom - 0.5
      const sy = (h[3] * u + h[4] * v + h[5]) / denom - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        let acc = 0
        let wsum = 0
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const px = x0 + i
            const py = y0 + j
            if (px < 0 || py < 0 || px >= sw || py >= sh) continue
            const w = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fy : fy)
            acc += src[(py * sw + px) * 4 + c] * w
            wsum += w
          }
        }
        out[o + c] = wsum > 0 ? acc / wsum : 128
      }
    }
  }
  return out
}

/** 识别输入尺寸：高度固定 48，宽度按框宽高比取整，夹在 [16, REC_IMG_MAX_WIDTH] */
export function recStripSize(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad
  const w = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2
  const hgt = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2
  const ratio = w / Math.max(1, hgt)
  const width = Math.min(REC_IMG_MAX_WIDTH, Math.max(16, Math.round(REC_IMG_HEIGHT * ratio)))
  return { width, height: REC_IMG_HEIGHT }
}

/** 把检测坐标系下的框映射回源图坐标系 */
export function scaleQuad(quad: Quad, sx: number, sy: number): Quad {
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad
}

/** 解析 ppocr 字典：每行一个字符，末尾补空格（use_space_char: true） */
export function parseCharset(dictText: string): string[] {
  const chars = dictText.split(/\r?\n/).filter((line) => line !== '')
  return [...chars, ' ']
}

export interface CtcResult {
  text: string
  confidence: number
}

/**
 * CTC 贪心解码：逐步取 argmax，去 blank（下标 0）并折叠连续重复，
 * 字符表 charset 对应下标 1..C-1（下标 0 是 blank，不在 charset 里）。
 * 置信度取贡献字符步的平均最大概率。
 */
export function ctcGreedyDecode(
  probs: ArrayLike<number>,
  timeSteps: number,
  classes: number,
  charset: string[],
): CtcResult {
  let text = ''
  let sum = 0
  let count = 0
  let prev = -1
  for (let t = 0; t < timeSteps; t++) {
    const base = t * classes
    let best = 0
    let bestP = -Infinity
    for (let c = 0; c < classes; c++) {
      const p = probs[base + c]
      if (p > bestP) {
        bestP = p
        best = c
      }
    }
    if (best === 0) {
      prev = -1
      continue
    }
    if (best === prev) continue
    prev = best
    const ch = charset[best - 1]
    if (ch === undefined) continue
    text += ch
    sum += bestP
    count++
  }
  return { text, confidence: count > 0 ? sum / count : 0 }
}
