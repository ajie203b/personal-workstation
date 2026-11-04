import type { InkPoint, Stroke } from './types'
type Point = Pick<InkPoint, 'x' | 'y'>
function contains(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const u = cross(a,b,c), v = cross(a,b,d), w = cross(c,d,a), z = cross(c,d,b)
  return u * v < 0 && w * z < 0
}
export function selectInLasso(strokes: Stroke[], polygon: Point[]): string[] {
  if (polygon.length < 3) return []
  return strokes.filter(s => s.points.some(p => contains(p, polygon)) || s.points.some((p, i) => i > 0 && polygon.some((q, j) => crosses(s.points[i - 1], p, q, polygon[(j + 1) % polygon.length])))).map(s => s.id)
}
export function transformStrokes(strokes: Stroke[], ids: Set<string>, dx: number, dy: number, scale = 1, center: Point = { x: 0, y: 0 }): Stroke[] {
  return strokes.map(s => ids.has(s.id) ? { ...s, width: s.width * scale, points: s.points.map(p => ({ ...p, x: center.x + (p.x - center.x) * scale + dx, y: center.y + (p.y - center.y) * scale + dy })) } : s)
}
