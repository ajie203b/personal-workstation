/**
 * 手写签名的纯逻辑（PDF 工具箱）：笔迹平滑、按速度变线宽、dataURL ↔ 字节、放置矩形。
 * 不碰 DOM / DB，画板组件（SignaturePanel）与单测共用这里的算法。
 */

export interface StrokePoint {
  x: number
  y: number
  /** performance.now() 毫秒 */
  t: number
}

export interface QuadSegment {
  from: { x: number; y: number }
  ctrl: { x: number; y: number }
  to: { x: number; y: number }
}

/**
 * 二次贝塞尔中点平滑：相邻两段的中点作端点、原点作控制点，
 * 折线变成连续可导的曲线，快速甩笔不再有棱角。
 */
export function smoothStroke(points: StrokePoint[]): QuadSegment[] {
  if (points.length < 2) return []
  const mid = (a: StrokePoint, b: StrokePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const segs: QuadSegment[] = []
  let from = { x: points[0].x, y: points[0].y }
  for (let i = 1; i < points.length - 1; i++) {
    const to = mid(points[i], points[i + 1])
    segs.push({ from, ctrl: { x: points[i].x, y: points[i].y }, to })
    from = to
  }
  const last = points[points.length - 1]
  segs.push({ from, ctrl: { x: last.x, y: last.y }, to: { x: last.x, y: last.y } })
  return segs
}

/**
 * 速度（px/ms）→ 线宽：越快越细（模拟钢笔出锋），最细到 minPx，最粗到 basePx。
 * 两次采样距离近、时间差小才是「快」，所以要按实际 dt 归一，不能只看像素距离。
 */
export function velocityWidth(prev: StrokePoint, cur: StrokePoint, basePx: number, minPx: number): number {
  const dt = Math.max(1, cur.t - prev.t)
  const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y)
  const v = dist / dt
  const w = basePx / (1 + v * 0.35)
  return Math.min(basePx, Math.max(minPx, w))
}

/** dataURL（image/png;base64,…）→ 原始字节 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('签名数据格式不对（不是 dataURL）')
  const base64 = dataUrl.slice(comma + 1)
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** 字节 → dataURL（存 db.signatures 用） */
export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** 签名笔迹数据往返的等价性（单测用）：dataURL → 字节 → dataURL 应原样回去 */
export function roundTripDataUrl(dataUrl: string): string {
  return bytesToDataUrl(dataUrlToBytes(dataUrl), dataUrl.slice(5, dataUrl.indexOf(';')))
}

/** 笔迹线宽参数（画板与导出共用，保证存下来的和画出来的一模一样） */
export const PEN_BASE_PX = 7
export const PEN_MIN_PX = 1.8
/** 单点（轻点一下）画圆点的半径 */
export const PEN_DOT_RADIUS = 1.5

export interface WidthSegment extends QuadSegment {
  width: number
}

/**
 * 一笔 → 带线宽的平滑线段列表（纯函数）。
 * 第 j 段的控制点是 points[j]（首段除外），线宽取 points[j]→points[j+1] 的速度。
 * 画板实时绘制与导出重绘都用它，结果逐段一致。
 */
export function strokeSegments(points: StrokePoint[], basePx = PEN_BASE_PX, minPx = PEN_MIN_PX): WidthSegment[] {
  const segs = smoothStroke(points)
  return segs.map((s, j) => ({
    ...s,
    width: velocityWidth(points[Math.min(j, points.length - 2)], points[Math.min(j + 1, points.length - 1)], basePx, minPx),
  }))
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 所有笔画（不只最后一笔）的墨迹包围盒，外扩「最粗线宽一半 + pad」，
 * 并夹在画板 [0, boardW]×[0, boardH] 内。没有笔画返回 null。
 *
 * v3.3.2 的 bug：只用了最后一笔的点算包围盒，且拿逻辑坐标去裁 dpr 倍的画布 →
 * 签名库里只剩一两段碎笔画。
 */
export function strokesBounds(strokes: StrokePoint[][], boardW: number, boardH: number, pad = 8, basePx = PEN_BASE_PX): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!Number.isFinite(minX)) return null
  const grow = basePx / 2 + pad
  const x0 = Math.max(0, Math.floor(minX - grow))
  const y0 = Math.max(0, Math.floor(minY - grow))
  const x1 = Math.min(boardW, Math.ceil(maxX + grow))
  const y1 = Math.min(boardH, Math.ceil(maxY + grow))
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

/** 画布上下文里画笔迹需要的最小接口（便于单测用假 ctx 记录调用） */
export interface InkContext {
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  beginPath(): void
  moveTo(x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  stroke(): void
  fill(): void
}

export const INK_COLOR = '#1c1c1e'

/** 画一段 */
export function drawSegment(ctx: InkContext, seg: WidthSegment): void {
  ctx.strokeStyle = INK_COLOR
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = seg.width
  ctx.beginPath()
  ctx.moveTo(seg.from.x, seg.from.y)
  ctx.quadraticCurveTo(seg.ctrl.x, seg.ctrl.y, seg.to.x, seg.to.y)
  ctx.stroke()
}

/** 画一个落笔点 */
export function drawDot(ctx: InkContext, p: { x: number; y: number }): void {
  ctx.fillStyle = INK_COLOR
  ctx.beginPath()
  ctx.arc(p.x, p.y, PEN_DOT_RADIUS, 0, Math.PI * 2)
  ctx.fill()
}

/** 整笔重绘（导出 / 画板尺寸变化后重绘用），坐标系由调用方的 transform 决定 */
export function drawStrokes(ctx: InkContext, strokes: StrokePoint[][]): void {
  for (const s of strokes) {
    if (!s.length) continue
    drawDot(ctx, s[0])
    for (const seg of strokeSegments(s)) drawSegment(ctx, seg)
  }
}
