/** 点（图像像素坐标） */
export interface Point {
  x: number
  y: number
}

/** 四边形，顺序：左上、右上、右下、左下 */
export type Quad = [Point, Point, Point, Point]

/** 检测输入最长边（约值，会再取整到 32 的倍数） */
export const DET_MAX_SIDE = 960

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

/** 四个角按 左上、右上、右下、左下 排序（先绕质心极角排严格环序，再把 x+y 最小点旋到首位，45° 旋转框也不打结） */
export function orderQuad(points: Point[]): Quad {
  if (points.length === 0) {
    const z = { x: 0, y: 0 }
    return [z, z, z, z]
  }
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const cyclic = [...points].sort((a, b) => {
    const ang = Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
    if (Math.abs(ang) > 1e-9) return ang
    return Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)
  })
  while (cyclic.length < 4) cyclic.push(cyclic[cyclic.length - 1])
  const ring = cyclic.slice(0, 4)
  let start = 0
  for (let i = 1; i < 4; i++) {
    const cur = ring[i]
    const best = ring[start]
    const diff = cur.x + cur.y - (best.x + best.y)
    if (diff < -1e-6 || (Math.abs(diff) <= 1e-6 && (cur.y < best.y || (cur.y === best.y && cur.x < best.x)))) {
      start = i
    }
  }
  return [ring[start], ring[(start + 1) % 4], ring[(start + 2) % 4], ring[(start + 3) % 4]]
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

/** 把检测坐标系下的框映射回源图坐标系 */
export function scaleQuad(quad: Quad, sx: number, sy: number): Quad {
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad
}
