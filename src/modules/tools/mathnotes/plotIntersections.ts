import type { PlotCurve } from './plot'

type Segment = [number, number, number, number]
export interface Intersection { x: number; y: number; screenX: number; screenY: number; first: number; second: number }

/** 使用与绘图一致的断点规则，避免跨越无定义点制造交点。 */
function segmentsOf(curve: PlotCurve, range: number, centerX: number, centerY: number): Segment[] {
  if (curve.kind === 'implicit') return curve.segments
  if (curve.kind === 'surface' || curve.kind === 'parametric3d') return []
  const segments: Segment[] = []
  let last: [number, number] | null = null
  const points = curve.kind === 'explicit'
    ? curve.values.map((value, i): [number, number] | null => value == null || !Number.isFinite(value) || Math.abs(value - centerY) > range * 4 ? null : [i / Math.max(1, curve.values.length - 1) * 400, 200 - (value - centerY) / range * 200])
    : curve.points.map((p): [number, number] | null => !p || !p.every(Number.isFinite) || Math.abs(p[0] - centerX) > range * 4 || Math.abs(p[1] - centerY) > range * 4 ? null : [200 + (p[0] - centerX) / range * 200, 200 - (p[1] - centerY) / range * 200])
  for (const point of points) {
    if (!point) { last = null; continue }
    if (last) {
      const jump = curve.kind === 'explicit' ? Math.abs(point[1] - last[1]) : Math.hypot(point[0] - last[0], point[1] - last[1])
      if (jump <= 400) segments.push([last[0], last[1], point[0], point[1]])
    }
    last = point
  }
  return segments
}

function cross(a: Segment, b: Segment): [number, number] | null {
  const [x, y, x2, y2] = a, [u, v, u2, v2] = b
  const dx = x2 - x, dy = y2 - y, ex = u2 - u, ey = v2 - v
  const den = dx * ey - dy * ex
  if (Math.abs(den) < 1e-9) return null // 平行或重合：不虚构唯一交点
  const t = ((u - x) * ey - (v - y) * ex) / den
  const s = ((u - x) * dy - (v - y) * dx) / den
  if (t < -1e-9 || t > 1 + 1e-9 || s < -1e-9 || s > 1 + 1e-9) return null
  const px = x + t * dx, py = y + t * dy
  return px >= 0 && px <= 400 && py >= 0 && py <= 400 ? [px, py] : null
}

/** 网格索引只比较同一区域的线段，最多返回 50 个近似交点。 */
export function findIntersections(curves: PlotCurve[], range: number, centerX = 0, centerY = 0): { points: Intersection[]; truncated: boolean } {
  if (!(range > 0)) return { points: [], truncated: false }
  const data = curves.map(c => segmentsOf(c, range, centerX, centerY))
  const points: Intersection[] = []
  const cells = (s: Segment): number[] => {
    const minX = Math.max(0, Math.min(s[0], s[2])), maxX = Math.min(400, Math.max(s[0], s[2]))
    const minY = Math.max(0, Math.min(s[1], s[3])), maxY = Math.min(400, Math.max(s[1], s[3]))
    if (minX > maxX || minY > maxY) return []
    const out: number[] = []
    for (let x = Math.min(15, Math.floor(minX / 25)); x <= Math.min(15, Math.floor(maxX / 25)); x++)
      for (let y = Math.min(15, Math.floor(minY / 25)); y <= Math.min(15, Math.floor(maxY / 25)); y++) out.push(x * 16 + y)
    return out
  }
  for (let first = 0; first < data.length; first++) for (let second = first + 1; second < data.length; second++) {
    const buckets = new Map<number, number[]>()
    data[second].forEach((segment, i) => { for (const cell of cells(segment)) { const bucket = buckets.get(cell) ?? []; bucket.push(i); buckets.set(cell, bucket) } })
    for (const segment of data[first]) {
      const candidates = new Set<number>()
      for (const cell of cells(segment)) for (const index of buckets.get(cell) ?? []) candidates.add(index)
      for (const index of candidates) {
        const hit = cross(segment, data[second][index])
        if (!hit || points.some(p => p.first === first && p.second === second && Math.hypot(p.screenX - hit[0], p.screenY - hit[1]) < 0.5)) continue
        if (points.length >= 50) return { points, truncated: true }
        points.push({ first, second, screenX: hit[0], screenY: hit[1], x: centerX + (hit[0] - 200) / 200 * range, y: centerY + (200 - hit[1]) / 200 * range })
      }
    }
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y)
  return { points, truncated: false }
}


/** 找距离点击位置最近的曲线点，用于查看采样坐标。 */
export function nearestCurvePoint(curves: PlotCurve[], range: number, sx: number, sy: number, centerX = 0, centerY = 0): { x: number; y: number; screenX: number; screenY: number; label: string } | null {
  let nearest: { x: number; y: number; screenX: number; screenY: number; label: string } | null = null
  let distance = 25
  for (const curve of curves) for (const [x1, y1, x2, y2] of segmentsOf(curve, range, centerX, centerY)) {
    const dx = x2 - x1, dy = y2 - y1, squared = dx * dx + dy * dy
    const t = squared ? Math.max(0, Math.min(1, ((sx - x1) * dx + (sy - y1) * dy) / squared)) : 0
    const x = x1 + t * dx, y = y1 + t * dy, d = Math.hypot(x - sx, y - sy)
    if (d < distance && x >= 0 && x <= 400 && y >= 0 && y <= 400) {
      distance = d; nearest = { x: centerX + (x - 200) / 200 * range, y: centerY + (200 - y) / 200 * range, screenX: x, screenY: y, label: curve.label }
    }
  }
  return nearest
}
