/**
 * 数学笔记进备份 / WebDAV 同步时的紧凑编码（纯函数，便于单测）。
 *
 * 一页笔记动辄上万个采样点，原样 JSON（{"x":123.456789,"y":…,"p":0.5,"t":1730000000000}）
 * 每个点 60 字节左右，同步文件会被笔迹撑大好几倍。这里把每笔压成一串整数：
 *
 *   pts = [x·10, y·10, p·100, Δt, x·10, y·10, p·100, Δt, …]
 *
 * - 坐标保留 0.1 CSS 像素（远小于笔宽，渲染与识别都看不出差别）
 * - 压感保留 0.01
 * - 时间存相对上一个点的毫秒差，首点相对 t0（笔画起始时刻，原样保留）
 *
 * 只做取整，不丢点、不丢笔画：解码回来就是一页能继续编辑、能重新识别的笔记。
 * 解码同时接受未编码的原始行（手改过的备份、以后的格式），老数据不会被拒。
 */
import type { InkPoint, MathNotePage, Stroke } from './types'

export const MATH_NOTE_CODEC = 1

/** 备份里的一笔：points 换成整数串 pts */
export interface PackedStroke {
  id: string
  width: number
  t0: number
  pts: number[]
}

export type PackedMathNote = Omit<MathNotePage, 'strokes'> & { enc: typeof MATH_NOTE_CODEC; strokes: PackedStroke[] }

const r = (v: number, k: number) => Math.round((Number.isFinite(v) ? v : 0) * k)

export function packStroke(s: Stroke): PackedStroke {
  const t0 = s.points.length ? Math.round(s.points[0].t) : 0
  const pts: number[] = []
  let prevT = t0
  for (const p of s.points) {
    const t = Math.round(p.t)
    pts.push(r(p.x, 10), r(p.y, 10), r(p.p, 100), t - prevT)
    prevT = t
  }
  return { id: s.id, width: s.width, t0, pts }
}

export function unpackStroke(s: PackedStroke): Stroke {
  const points: InkPoint[] = []
  let t = s.t0
  for (let i = 0; i + 3 < s.pts.length; i += 4) {
    t += s.pts[i + 3]
    points.push({ x: s.pts[i] / 10, y: s.pts[i + 1] / 10, p: s.pts[i + 2] / 100, t })
  }
  return { id: s.id, width: s.width, points }
}

export function packMathNote(page: MathNotePage): PackedMathNote {
  return { ...page, enc: MATH_NOTE_CODEC, strokes: page.strokes.map(packStroke) }
}

function isPacked(s: unknown): s is PackedStroke {
  return typeof s === 'object' && s !== null && Array.isArray((s as PackedStroke).pts)
}

/** 备份行 → 本地行。编码过的解码；原始 points 形式原样收下 */
export function unpackMathNote(row: PackedMathNote | MathNotePage | Record<string, unknown>): MathNotePage {
  const { enc: _enc, ...rest } = row as PackedMathNote
  const strokes = ((rest.strokes ?? []) as unknown[]).map((s) => (isPacked(s) ? unpackStroke(s) : (s as Stroke)))
  return { ...(rest as unknown as MathNotePage), strokes, results: Array.isArray(rest.results) ? rest.results : [] }
}
