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
