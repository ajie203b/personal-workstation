import { ComputeEngine } from '@cortex-js/compute-engine'
import { normalizeLatex } from './compute'

/** 把常见的 y= / f(x)= 函数写法转换为表达式；不执行用户提供的代码。 */
export function sampleFunction(input: string, min: number, max: number, count: number, variables: Record<string, number> = {}): (number | null)[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || count < 2 || count > 1000) throw new Error('绘图范围无效')
  let text = input.trim()
  if (!text || text.length > 300) throw new Error('请输入不超过 300 个字符的函数')
  text = text.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i, '')
  if (text.includes('=')) throw new Error('请输入 y=f(x) 形式的函数')
  text = normalizeLatex(text).replace(/(?<![a-zA-Z\\])(sin|cos|tan|sqrt|ln|log)(?=\s*\()/g, '\\$1')
  const ce = new ComputeEngine()
  const parsed = ce.parse(text)
  const expr = parsed?.subs(Object.fromEntries(Object.entries(variables).filter(([name]) => name !== 'x')))
  if (!expr || !expr.isValid || expr.unknowns.some(s => s !== 'x')) throw new Error('无法识别函数，请检查表达式，只支持变量 x')
  return Array.from({ length: count }, (_, i) => {
    const x = min + (max - min) * i / (count - 1)
    try {
      const value = expr.subs({ x }).N()
      const y = value.re
      return Number.isFinite(y) && (value.im === 0 || value.im == null) ? y : null
    } catch { return null }
  })
}


export type PlotCurve =
  | { kind: 'explicit'; label: string; values: (number | null)[] }
  | { kind: 'implicit'; label: string; segments: [number, number, number, number][] }
  | { kind: 'parametric'; label: string; points: ([number, number] | null)[] }
  | { kind: 'parametric3d'; label: string; points: ([number, number, number] | null)[] }
  | { kind: 'surface'; label: string; values: (number | null)[][] }

/** 用网格等值线画隐式方程；坐标为 400×400 视口坐标。 */
function sampleImplicit(text: string, min: number, max: number, count: number, variables: Record<string, number>, centerY = 0): PlotCurve {
  const parts = text.split('=')
  if (parts.length !== 2 || parts.some(p => !p.trim())) throw new Error('隐式方程需要一个等号，例如 x^2+y^2=25')
  const convert = (s: string) => normalizeLatex(s).replace(/(?<![a-zA-Z\\])(sin|cos|tan|sqrt|ln|log)(?=\s*\()/g, '\\$1')
  const ce = new ComputeEngine()
  const expr = ce.parse(`(${convert(parts[0])})-(${convert(parts[1])})`)?.subs(Object.fromEntries(Object.entries(variables).filter(([name]) => name !== 'x' && name !== 'y')))
  if (!expr || !expr.isValid || expr.unknowns.some(v => v !== 'x' && v !== 'y')) throw new Error('无法识别隐式方程，只支持变量 x 和 y')
  const n = Math.min(72, Math.max(32, count - 1))
  const grid: (number | null)[][] = []
  for (let row = 0; row <= n; row++) {
    const y = centerY + (max - min) / 2 - (max - min) * row / n
    const line: (number | null)[] = []
    for (let col = 0; col <= n; col++) {
      const x = min + (max - min) * col / n
      try {
        const v = expr.subs({ x, y }).N()
        line.push(Number.isFinite(v.re) && (v.im === 0 || v.im == null) ? v.re : null)
      } catch { line.push(null) }
    }
    grid.push(line)
  }
  const segments: [number, number, number, number][] = []
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const v = [grid[row][col], grid[row][col + 1], grid[row + 1][col + 1], grid[row + 1][col]]
    if (v.some(x => x == null)) continue
    const xy = [[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1]]
    const hits: number[][] = []
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, a = v[i]!, b = v[j]!
      if ((a < 0) === (b < 0)) continue
      const t = a / (a - b)
      hits.push([(xy[i][0] + (xy[j][0] - xy[i][0]) * t) * 400 / n, (xy[i][1] + (xy[j][1] - xy[i][1]) * t) * 400 / n])
    }
    for (let i = 0; i + 1 < hits.length; i += 2) segments.push([hits[i][0], hits[i][1], hits[i + 1][0], hits[i + 1][1]])
  }
  return { kind: 'implicit', label: text, segments }
}

/** 括号中最外层的逗号用于分隔 x(t) 与 y(t)，函数内部的逗号不会被拆开。 */
function parametricParts(text: string): string[] | null {
  const value = text.trim()
  if (!value.startsWith('(') || !value.endsWith(')')) return null
  const body = value.slice(1, -1), parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(' || body[i] === '{') depth++
    else if (body[i] === ')' || body[i] === '}') depth--
    else if (body[i] === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1 }
    if (depth < 0) return null
  }
  if (depth !== 0 || parts.length < 1 || parts.length > 2) return null
  parts.push(body.slice(start))
  return parts
}

function prepareExpression(text: string) {
  return normalizeLatex(text).replace(/(?<![a-zA-Z\\])(sin|cos|tan|sqrt|ln|log)(?=\s*\()/g, '\\$1')
}

function sampleParametric(label: string, parts: string[], count: number, tMin: number, tMax: number, variables: Record<string, number>): PlotCurve {
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin >= tMax || Math.abs(tMin) > 1e6 || Math.abs(tMax) > 1e6) throw new Error('参数范围无效，请确保起点小于终点')
  const ce = new ComputeEngine()
  const expressions = parts.map(part => ce.parse(prepareExpression(part))?.subs(Object.fromEntries(Object.entries(variables).filter(([name]) => name !== 't'))))
  if (expressions.some(expr => !expr || !expr.isValid || expr.unknowns.some(v => v !== 't'))) throw new Error('参数方程只支持变量 t，例如 (cos(t), sin(t))')
  const points = Array.from({ length: count }, (_, i): number[] | null => {
    const t = tMin + (tMax - tMin) * i / (count - 1)
    try {
      const values = expressions.map(expr => expr!.subs({ t }).N())
      return values.every(v => Number.isFinite(v.re) && (v.im === 0 || v.im == null)) ? values.map(v => v.re) : null
    } catch { return null }
  })
  return parts.length === 3
    ? { kind: 'parametric3d', label, points: points as ([number, number, number] | null)[] }
    : { kind: 'parametric', label, points: points as ([number, number] | null)[] }
}

function sampleSurface(label: string, min: number, max: number, variables: Record<string, number>): PlotCurve {
  const source = label.replace(/^\s*z\s*=/i, '')
  if (!source.trim() || source.includes('=')) throw new Error('三维曲面请输入 z=f(x,y)')
  const expr = new ComputeEngine().parse(prepareExpression(source))?.subs(Object.fromEntries(Object.entries(variables).filter(([name]) => name !== 'x' && name !== 'y')))
  if (!expr || !expr.isValid || expr.unknowns.some(v => v !== 'x' && v !== 'y')) throw new Error('三维曲面只支持变量 x 和 y')
  const n = 30
  const values: (number | null)[][] = []
  for (let row = 0; row <= n; row++) {
    const y = min + (max - min) * row / n
    const line: (number | null)[] = []
    for (let col = 0; col <= n; col++) {
      const x = min + (max - min) * col / n
      try {
        const v = expr.subs({ x, y }).N()
        line.push(Number.isFinite(v.re) && (v.im === 0 || v.im == null) ? v.re : null)
      } catch { line.push(null) }
    }
    values.push(line)
  }
  return { kind: 'surface', label, values }
}

/** 每行一条曲线：显函数或含 x、y 的隐式方程。 */
export function sampleCurves(input: string, min: number, max: number, count: number, tMin = -Math.PI * 2, tMax = Math.PI * 2, variables: Record<string, number> = {}, centerX = 0, centerY = 0): PlotCurve[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || !Number.isInteger(count) || count < 2 || count > 1000) throw new Error('绘图范围无效')
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) throw new Error('绘图中心无效')
  const lines = input.split(/[\n;；]+/).map(s => s.trim()).filter(Boolean)
  if (!lines.length || lines.length > 5) throw new Error('请输入 1 至 5 条曲线，每行一条')
  if (lines.some(line => /^\s*z\s*=/i.test(line)) && lines.length !== 1) throw new Error('三维曲面请单独绘制')
  const curves = lines.map(label => {
    if (label.length > 300) throw new Error('每条曲线最多 300 个字符')
    if (/^\s*z\s*=/i.test(label)) return sampleSurface(label, min, max, variables)
    const parts = parametricParts(label)
    if (parts) return sampleParametric(label, parts, count, tMin, tMax, variables)
    const prefix = label.match(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i)
    const rhsHasY = prefix && /(?<![a-zA-Z\\])y(?![a-zA-Z])/.test(label.slice(prefix[0].length))
    const isExplicit = !label.includes('=') || (Boolean(prefix) && !rhsHasY)
    return isExplicit ? { kind: 'explicit' as const, label, values: sampleFunction(label, min + centerX, max + centerX, count, variables) } : sampleImplicit(label, min + centerX, max + centerX, count, variables, centerY)
  })
  if (curves.some(c => c.kind === 'surface' || c.kind === 'parametric3d') && curves.some(c => c.kind !== 'surface' && c.kind !== 'parametric3d')) throw new Error('二维与三维图像请分别绘制')
  return curves
}
