/**
 * LaTeX → 计算结果。主力是 CortexJS Compute Engine（直接解析 LaTeX，纯 JS，离线）：
 * 四则、三角（含角度 ° 与 DEG/RAD 模式）、对数、复数、阶乘、组合数、解方程/方程组、求导、定积分/不定积分、
 * 极限、求和、矩阵乘法/求逆/转置/行列式都能覆盖。
 *
 * 以后要接 Giac（wasm，体积约 10MB+）处理更重的符号运算，实现同样的 MathBackend 接口即可。
 */
import { ComputeEngine } from '@cortex-js/compute-engine'
import type { AngleMode, ComputeResult } from './types'
import { computeUnits } from './units'
import { flattenColumnArithmetic, normalizeLatex, substituteVarsInLatex } from './latexNormalize'

export { flattenColumnArithmetic, normalizeLatex }

export interface ComputeOptions {
  angleMode?: AngleMode
  variables?: Record<string, number>
}

export interface MathBackend {
  readonly id: string
  compute(latex: string, opts?: ComputeOptions): ComputeResult
}

/**
 * 本模块用到的 Compute Engine 表达式能力。官方类型按「函数 / 数值 / 符号」细分且 parse 可能返回 null，
 * 逐处收窄会把逻辑淹没；这里收成一个宽松视图，行为由 compute.test.ts 覆盖。
 */
interface Expr {
  readonly json: unknown
  readonly latex: string
  readonly operator: string
  readonly ops?: ReadonlyArray<Expr> | null
  readonly isValid: boolean
  readonly isNumberLiteral: boolean
  readonly isInteger?: boolean
  readonly isRational?: boolean
  readonly re: number
  readonly im: number
  readonly unknowns?: ReadonlyArray<string>
  subs(map: Record<string, number>): Expr
  evaluate(): Expr
  N(): Expr
  simplify(): Expr
}

let engine: ComputeEngine | null = null

/** 复用同一个 ComputeEngine 实例，避免计算与绘图重复初始化字典与符号表。 */
export function getComputeEngine(): ComputeEngine {
  return (engine ??= new ComputeEngine())
}

const engineRef = {
  parse(latex: string): Expr {
    const e = getComputeEngine().parse(latex) as unknown as Expr | null
    if (!e) throw new Error('解析失败')
    return e
  },
  box(json: unknown): Expr {
    return getComputeEngine().box(json as never) as unknown as Expr
  },
}

/* ============ 1. 规范化 ============ */

/** 竖式 / 多行：\begin{array}…\end{array} 等环境拆成行；columns 表示存在多列（矩阵式排布） */
function splitRows(s: string): { env: string; rows: string[]; columns: boolean } | null {
  const m = s.match(/^\\begin\{(array|aligned|gathered|matrix|split|cases)\}(?:\{[^}]*\})?([\s\S]*)\\end\{\1\}$/)
  if (!m) return null
  const rawRows = m[2].split(/\\\\/)
  // 「x+y &= 3」是对齐用的 &；「1 & 2」两边都是内容才算多列
  const columns = rawRows.some((r) => /[^\s=&]\s*&\s*[^\s=&]/.test(r.replace(/\\hline/g, '')))
  const rows = rawRows
    .map((r) => r.replace(/\\hline/g, '').replace(/&/g, '').trim())
    .map((r) => r.replace(/^\{([\s\S]*)\}$/, '$1').trim())
    .filter(Boolean)
  return { env: m[1], rows, columns }
}

/* ============ 3. 格式化 ============ */

/** 数字 → 最多 10 位有效数字；过大/过小用科学计数 */
export function formatNumber(x: number): { text: string; latex: string } {
  if (!Number.isFinite(x)) return { text: String(x), latex: x > 0 ? '\\infty' : x < 0 ? '-\\infty' : '\\text{NaN}' }
  if (Object.is(x, -0)) x = 0
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return { text: String(x), latex: String(x) }
  const abs = Math.abs(x)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) {
    const [mant, exp] = x.toExponential(6).split('e')
    const m = mant.replace(/\.?0+$/, '')
    const e = Number(exp)
    return { text: `${m}×10^${e}`, latex: `${m}\\times10^{${e}}` }
  }
  const t = Number(x.toPrecision(10)).toString()
  return { text: t, latex: t }
}

/** Compute Engine 的 LaTeX 输出整理：\imaginaryI → i，去千分位细空格，\bigl 括号换普通 */
export function tidyLatex(s: string): string {
  return s
    .replace(/\\imaginaryI/g, 'i')
    .replace(/\\exponentialE/g, 'e')
    .replace(/\\,/g, '')
    .replace(/\\(?:bigl|bigr|Bigl|Bigr)/g, '')
    .replace(/\\lbrack/g, '[')
    .replace(/\\rbrack/g, ']')
    .replace(/\\operatorname\{([a-z]+)\}/g, '\\$1')
}

function isList(e: Expr): boolean {
  return e.operator === 'List' || e.operator === 'Matrix'
}

function rowsOf(e: Expr): Expr[] | null {
  const inner = e.operator === 'Matrix' ? e.ops?.[0] : e
  if (!inner || inner.operator !== 'List') return null
  return [...(inner.ops ?? [])]
}

/** 单个数 / 表达式的显示形式（精确值优先，必要时补近似） */
function formatScalar(e: Expr): { latex: string; text: string; alt?: string } {
  if (e.isNumberLiteral) {
    const re = e.re
    const im = e.im
    if (typeof im === 'number' && im !== 0 && Number.isFinite(im)) {
      const a = formatNumber(re)
      const b = formatNumber(Math.abs(im))
      const bi = b.text === '1' ? 'i' : `${b.text}i`
      const text = re === 0 ? `${im < 0 ? '-' : ''}${bi}` : `${a.text}${im < 0 ? '-' : '+'}${bi}`
      return { latex: text, text }
    }
    if (e.isInteger) {
      const n = formatNumber(re)
      // 超出 double 精度的大整数用 Compute Engine 的精确写法
      if (Math.abs(re) >= 1e15) return { latex: tidyLatex(e.latex), text: '', alt: n.text }
      return n.latex === n.text ? { latex: n.latex, text: n.text } : { latex: n.latex, text: '' }
    }
    if (e.isRational) {
      const exact = tidyLatex(e.latex)
      const approx = formatNumber(re)
      return { latex: exact, text: '', alt: approx.text }
    }
    const approx = formatNumber(re)
    const exact = tidyLatex(e.latex)
    // 精确写法里有根号、π 等才值得同时展示
    if (/\\sqrt|\\pi|\\frac|\\ln|\\log|e\^/.test(exact) && exact.length < 40) return { latex: exact, text: '', alt: approx.text }
    return { latex: approx.latex, text: approx.text }
  }
  // 非数值（符号结果），尝试求近似
  const latex = tidyLatex(e.latex)
  if (!e.unknowns?.length) {
    const n = e.N()
    if (n.isNumberLiteral && typeof n.re === 'number' && Number.isFinite(n.re) && Math.abs(n.im ?? 0) <= 1e-12 * Math.max(1, Math.abs(n.re))) {
      return { latex, text: '', alt: formatNumber(n.re).text }
    }
  }
  return { latex, text: '' }
}

function matrixLatex(rows: Expr[]): string {
  const body = rows
    .map((r) => {
      const cells = r.operator === 'List' ? [...(r.ops ?? [])] : [r]
      return cells.map((c) => formatScalar(c).latex).join(' & ')
    })
    .join(' \\\\ ')
  return `\\begin{pmatrix} ${body} \\end{pmatrix}`
}

function formatValue(e: Expr): { latex: string; text: string; alt?: string; matrix: boolean } {
  if (isList(e)) {
    const rows = rowsOf(e)
    if (rows && rows.length) {
      const nested = rows.every((r) => r.operator === 'List')
      // 一维 List 视为列向量
      return { latex: matrixLatex(nested ? rows : rows), text: '', matrix: true }
    }
  }
  return { ...formatScalar(e), matrix: false }
}

/* ============ 2. 求值 / 解方程 ============ */

function error(message: string): ComputeResult {
  return { kind: 'error', latex: '', text: '', message }
}

function invalid(e: Expr): boolean {
  return !e.isValid || JSON.stringify(e.json).includes('"Error"')
}

function hasCalculus(e: Expr): boolean {
  return /"(D|Integrate|Limit|Sum|Product|Derivative)"/.test(JSON.stringify(e.json))
}

/** 递归检测表达式 JSON 中是否存在值为 0 的除数或负幂底数 */
function hasZeroDenominator(json: unknown): boolean {
  if (!Array.isArray(json)) return false
  const [op, ...args] = json
  if (op === 'Divide' && args.length >= 2) {
    try {
      const d = engineRef.box(args[1]).N()
      if (d.isNumberLiteral && Math.abs(d.re) <= 1e-12 && Math.abs(d.im ?? 0) <= 1e-12) return true
    } catch { /* ignore */ }
  }
  if (op === 'Power' && args.length >= 2) {
    try {
      const exp = engineRef.box(args[1]).N()
      const base = engineRef.box(args[0]).N()
      if (exp.isNumberLiteral && exp.re < 0 && base.isNumberLiteral && Math.abs(base.re) <= 1e-12 && Math.abs(base.im ?? 0) <= 1e-12) {
        return true
      }
    } catch { /* ignore */ }
  }
  return args.some(hasZeroDenominator)
}

function classifyNonFiniteResult(expr: Expr, value: Expr, rawBody = ''): ComputeResult | null {
  const j = value.json
  if (j === 'Indeterminate' || value.latex === '\\operatorname{NaN}' || (value.isNumberLiteral && Number.isNaN(value.re))) {
    return error('不定式（0/0 或无法确定值）')
  }
  if (j === 'ComplexInfinity') {
    const isDiv = hasZeroDenominator(expr.json) || (!/\\(?:tan|cot|sec|csc)/.test(rawBody) && /(?:\/|\\frac|\\div|\^\{?\s*-)/.test(rawBody))
    return error(isDiv ? '除数不能为 0' : '无定义（趋于无穷）')
  }
  if ((j === 'PositiveInfinity' || j === 'NegativeInfinity' || j === 'Infinity') && hasZeroDenominator(expr.json)) {
    return error('除数不能为 0')
  }
  return null
}

function findInverseMatrixJson(json: unknown): unknown | null {
  if (!Array.isArray(json)) return null
  if (json[0] === 'Inverse' && json.length >= 2) return json[1]
  for (let i = 1; i < json.length; i++) {
    const found = findInverseMatrixJson(json[i])
    if (found != null) return found
  }
  return null
}

function classifyMatrixError(value: Expr): ComputeResult | null {
  if (value.operator !== 'Inverse' && !JSON.stringify(value.json).includes('"Inverse"')) return null
  const matJson = findInverseMatrixJson(value.json)
  if (!matJson) return error('矩阵不可逆')
  const mat = engineRef.box(matJson)
  if (mat.unknowns?.length) return null
  const rows = rowsOf(mat)
  if (rows && rows.length) {
    const colCount = rows[0].operator === 'List' ? (rows[0].ops?.length ?? 0) : 1
    if (rows.some((r) => (r.operator === 'List' ? r.ops?.length : 1) !== colCount) || rows.length !== colCount) {
      return error('仅方阵可求逆')
    }
    try {
      const det = engineRef.box(['Determinant', matJson]).N()
      if (det.isNumberLiteral && Math.abs(det.re) <= 1e-10 && Math.abs(det.im ?? 0) <= 1e-10) {
        return error('奇异矩阵不可逆')
      }
    } catch { /* ignore */ }
  }
  return error('奇异矩阵不可逆')
}

function containsAnyUnknown(json: unknown, unknowns: Set<string>): boolean {
  if (typeof json === 'string') return unknowns.has(json)
  if (!Array.isArray(json)) return false
  for (let i = 1; i < json.length; i++) {
    if (containsAnyUnknown(json[i], unknowns)) return true
  }
  return false
}

function isLinearJson(json: unknown, unknowns: Set<string>): boolean {
  if (typeof json === 'number' || typeof json === 'string') return true
  if (json && typeof json === 'object' && !Array.isArray(json)) return true
  if (!Array.isArray(json) || !json.length) return false
  const [op, ...args] = json
  if (op === 'Negate') return args.length === 1 && isLinearJson(args[0], unknowns)
  if (op === 'Add' || op === 'Subtract') return args.every((a) => isLinearJson(a, unknowns))
  if (op === 'Multiply') {
    let varBranch = 0
    for (const a of args) {
      if (containsAnyUnknown(a, unknowns)) {
        varBranch++
        if (varBranch > 1 || !isLinearJson(a, unknowns)) return false
      }
    }
    return true
  }
  if (op === 'Divide' && args.length === 2) {
    return isLinearJson(args[0], unknowns) && !containsAnyUnknown(args[1], unknowns)
  }
  return !containsAnyUnknown(json, unknowns)
}

/** 线性方程（组）高斯消元：精确区分无解、无穷多解与唯一解（Solve 兜底） */
function analyzeLinearSystem(equations: Expr[], unknowns: string[]): { status: 'none' | 'infinite' | 'unique'; solution?: number[] } | null {
  const unknownSet = new Set(unknowns)
  const diffs: Expr[] = []
  for (const eq of equations) {
    const lhs = eq.ops?.[0]
    const rhs = eq.ops?.[1]
    if (!lhs || !rhs) return null
    const diff = engineRef.box(['Subtract', lhs.json, rhs.json])
    if (!isLinearJson(diff.json, unknownSet)) return null
    diffs.push(diff)
  }

  const zeros = Object.fromEntries(unknowns.map((u) => [u, 0]))
  const m = diffs.length
  const n = unknowns.length
  const mat: number[][] = []
  for (let i = 0; i < m; i++) {
    const c0 = diffs[i].subs(zeros).N()
    if (!c0.isNumberLiteral || !Number.isFinite(c0.re) || Math.abs(c0.im ?? 0) > 1e-10) return null
    const bi = -c0.re
    const row: number[] = []
    for (let j = 0; j < n; j++) {
      const ej = { ...zeros, [unknowns[j]]: 1 }
      const cj = diffs[i].subs(ej).N()
      if (!cj.isNumberLiteral || !Number.isFinite(cj.re) || Math.abs(cj.im ?? 0) > 1e-10) return null
      row.push(cj.re + bi)
    }
    row.push(bi)
    mat.push(row)
  }

  // RREF 消元
  const pivotCols: number[] = []
  let r = 0
  for (let c = 0; c < n && r < m; c++) {
    let best = r
    for (let i = r + 1; i < m; i++) {
      if (Math.abs(mat[i][c]) > Math.abs(mat[best][c])) best = i
    }
    if (Math.abs(mat[best][c]) <= 1e-10) continue
    ;[mat[r], mat[best]] = [mat[best], mat[r]]
    const piv = mat[r][c]
    for (let j = c; j <= n; j++) mat[r][j] /= piv
    for (let i = 0; i < m; i++) {
      if (i === r || Math.abs(mat[i][c]) <= 1e-12) continue
      const factor = mat[i][c]
      for (let j = c; j <= n; j++) mat[i][j] -= factor * mat[r][j]
    }
    pivotCols.push(c)
    r++
  }

  for (let i = 0; i < m; i++) {
    const rowMax = Math.max(...mat[i].slice(0, n).map(Math.abs))
    if (rowMax <= 1e-9 && Math.abs(mat[i][n]) > 1e-9) return { status: 'none' }
  }
  if (pivotCols.length < n) return { status: 'infinite' }
  const solution = Array.from({ length: n }, (_, j) => mat[j][n])
  return { status: 'unique', solution }
}

/** 取复数的实部 / 虚部；虚部缺省（实数）按 0 处理 */
function complexParts(e: Expr): [number, number] {
  const re = typeof e.re === 'number' ? e.re : NaN
  const im = typeof e.im === 'number' && !Number.isNaN(e.im) ? e.im : 0
  return [re, im]
}

/**
 * 两个数值（可为复数）是否相等：实部、虚部同时比较。
 * 容差按复数模取相对误差：|l − r| ≤ 1e-9 · max(1, |l|, |r|)。
 */
export function complexNearlyEqual(a: [number, number], b: [number, number]): boolean {
  const [ar, ai] = a
  const [br, bi] = b
  if (![ar, ai, br, bi].every(Number.isFinite)) return false
  const diff = Math.hypot(ar - br, ai - bi)
  const scale = Math.max(1, Math.hypot(ar, ai), Math.hypot(br, bi))
  return diff <= 1e-9 * scale
}

function numbersEqual(l: Expr, r: Expr): boolean {
  return complexNearlyEqual(complexParts(l), complexParts(r))
}

/** 方程（组）求解 */
function solve(equations: Expr[]): ComputeResult {
  const unknowns = [...new Set(equations.flatMap((eq) => eq.unknowns ?? []))].sort()
  if (!unknowns.length) {
    // 没有未知数：验证等式
    const [eq] = equations
    const lhs = eq.ops?.[0]
    const rhs = eq.ops?.[1]
    if (!lhs || !rhs) return error('没认出这个等式')
    const l = lhs.N()
    const r = rhs.N()
    if (l.isNumberLiteral && r.isNumberLiteral && numbersEqual(l, r)) {
      return { kind: 'below', latex: '\\checkmark', text: '✓' }
    }
    const v = formatScalar(lhs.evaluate())
    return { kind: 'below', latex: `\\ne\\quad \\text{左边}=${v.latex}`, text: '', alt: v.alt }
  }
  if (unknowns.length > 4) return error('未知数太多，暂时解不了')

  const linear = analyzeLinearSystem(equations, unknowns)
  if (linear?.status === 'none') return { kind: 'solutions', latex: '\\text{无解}', text: '无解' }
  if (linear?.status === 'infinite') return { kind: 'solutions', latex: '\\text{无穷多解}', text: '无穷多解' }

  const target = unknowns.length === 1 ? unknowns[0] : ['List', ...unknowns]
  const system = equations.length === 1 ? equations[0].json : ['List', ...equations.map((e) => e.json)]
  const res = engineRef.box(['Solve', system, target]).evaluate()
  if (res.operator === 'Solve' || invalid(res)) {
    if (linear?.status === 'unique' && linear.solution) {
      const line = linear.solution.map((v, i) => `${unknowns[i]}=${formatNumber(v).latex}`).join(',\\ ')
      return { kind: 'solutions', latex: line, text: '' }
    }
    return error('这个方程暂时解不出来，可点开修改后重试')
  }
  const sols = res.operator === 'List' ? [...(res.ops ?? [])] : [res]
  if (!sols.length) return { kind: 'solutions', latex: '\\text{无解}', text: '无解' }
  // Solve 对恒等式会引入自由参数 t_1 / c_1
  const unknownSet = new Set(unknowns)
  if (sols.some((sol) => (sol.unknowns ?? []).some((u) => !unknownSet.has(u)))) {
    return { kind: 'solutions', latex: '\\text{无穷多解}', text: '无穷多解' }
  }
  const lines: string[] = []
  const alts: string[] = []
  sols.forEach((sol, idx) => {
    if (sol.operator === 'Tuple' || sol.operator === 'List') {
      const vals = [...(sol.ops ?? [])]
      lines.push(vals.map((v, i) => `${unknowns[i]}=${formatScalar(v).latex}`).join(',\\ '))
    } else {
      const f = formatScalar(sol)
      const name = sols.length > 1 ? `${unknowns[0]}_{${idx + 1}}` : unknowns[0]
      lines.push(`${name}=${f.latex}`)
      if (f.alt) alts.push(`${name}\\approx ${f.alt}`)
    }
  })
  return {
    kind: 'solutions',
    latex: lines.length > 1 ? `\\begin{aligned} ${lines.join(' \\\\ ')} \\end{aligned}` : lines[0],
    text: '',
    alt: alts.length ? alts.join(',\\ ') : undefined,
  }
}

function applyVars(expr: Expr, vars?: Record<string, number>): Expr {
  return vars && Object.keys(vars).length ? expr.subs(vars) : expr
}

/** 主入口：LaTeX → 结果 */
export function computeLatex(raw: string, opts: ComputeOptions = {}): ComputeResult {
  const vars = opts.variables
  const definedVars = vars ? new Set(Object.keys(vars)) : undefined
  const unitResult = computeUnits(raw, { definedVars })
  if (unitResult) return unitResult

  const ce = getComputeEngine()
  const prevAngle = ce.angularUnit
  ce.angularUnit = opts.angleMode ?? 'rad'
  try {
    const prepare = (src: string) => {
      const norm = normalizeLatex(src)
      return vars && Object.keys(vars).length ? substituteVarsInLatex(norm, vars).latex : norm
    }

    // 自然输入：每行或分号分隔一个方程；LaTeX 环境交给下方原有解析。
    if (!/\\begin\s*\{/.test(raw)) {
      const rows = raw.split(/\r?\n|(?<!\\)[;；]/).map((row) => row.trim()).filter(Boolean)
      if (rows.length > 1 && rows.some((row) => row.includes('=') || row.includes('＝'))) {
        if (rows.length > 4 || rows.some((row) => (row.match(/[=＝]/g) ?? []).length !== 1 || /[=＝]\s*$/.test(row))) {
          return error('方程组每行需要一个完整等式（最多四行）')
        }
        try {
          const equations = rows.map((row) => applyVars(engineRef.parse(prepare(row)), vars))
          if (equations.some((eq) => invalid(eq) || eq.operator !== 'Equal')) return error('方程组没认全，点开修改后重试')
          return solve(equations)
        } catch {
          return error('方程组无法求解，请检查每行等式')
        }
      }
    }

    let s = prepare(raw)
    if (!s) return { kind: 'none', latex: '', text: '' }

    // 多行环境：竖式 / 方程组
    const stacked = splitRows(s.replace(/^(?:\\left\s*)?\\\{\s*/, '').trim())
    if (stacked && stacked.env !== 'matrix' && !(stacked.columns && !stacked.rows.some((r) => r.includes('=')))) {
      const flat = flattenColumnArithmetic(stacked.rows)
      if (flat) s = `${flat}=`
      else if (stacked.rows.some((r) => r.includes('='))) {
        if (stacked.rows.some((row) => (row.match(/=/g) ?? []).length !== 1 || /=\s*$/.test(row))) {
          return error('方程组每行需要一个完整等式')
        }
        try {
          const eqs = stacked.rows.map((r) => applyVars(engineRef.parse(r), vars))
          if (eqs.some((eq) => invalid(eq) || eq.operator !== 'Equal')) return error('方程组没认全，点开修改后重试')
          return solve(eqs)
        } catch {
          return error('方程组无法求解，请检查每行等式')
        }
      }
    }

    const trailingEq = /=\s*$/.test(s)
    const body = s.replace(/=\s*$/, '').trim()
    if (!body) return { kind: 'none', latex: '', text: '' }

    // 中间有等号：方程（或「2+2=4」这种验算）
    if (!trailingEq && body.includes('=')) {
      const parts = body.split(/(?<![<>!\\])=/)
      if (parts.length === 2) {
        const eq = applyVars(engineRef.parse(body), vars)
        if (invalid(eq) || eq.operator !== 'Equal') return error('没认出这个方程，点开修改后重试')
        return solve([eq])
      }
      return error('一行里有多个等号，暂不支持')
    }

    let expr: Expr
    try {
      expr = applyVars(engineRef.parse(body), vars)
    } catch {
      return error('没认出这个算式，点开修改后重试')
    }
    if (invalid(expr)) return error('没认出这个算式，点开修改后重试')

    // 不带等号的普通算式不打扰；矩阵 / 微积分照算，结果放下方
    const matrixInput = /pmatrix|bmatrix|vmatrix|\\begin\{matrix\}|\\begin\{array\}/.test(body)
    if (!trailingEq && !matrixInput && !hasCalculus(expr)) return { kind: 'none', latex: '', text: '' }

    let value: Expr
    try {
      value = expr.evaluate()
      const rawJson = JSON.stringify(value.json)
      if ((rawJson.includes('expected-square-matrix') || rawJson.includes('incompatible-shape')) && JSON.stringify(expr.json).includes('"Inverse"')) {
        return error('仅方阵可求逆')
      }
      const matrixErr = classifyMatrixError(value)
      if (matrixErr) return matrixErr
      const nonFinite = classifyNonFiniteResult(expr, value, body)
      if (nonFinite) return nonFinite
      if (value.unknowns?.length && !hasCalculus(expr)) {
        // 含未知数的代数式：展开化简
        value = engineRef.box(['Expand', value.json]).evaluate().simplify()
      }
    } catch (e) {
      return error(e instanceof Error ? `计算失败：${e.message}` : '计算失败')
    }
    if (invalid(value)) return error('这个算式暂时算不了')
    const matrixErr = classifyMatrixError(value)
    if (matrixErr) return matrixErr
    const nonFinite = classifyNonFiniteResult(expr, value, body)
    if (nonFinite) return nonFinite

    const f = formatValue(value)
    let latex = f.latex
    // 不定积分补 +C
    if (/"Integrate"/.test(JSON.stringify(expr.json)) && /"Nothing"/.test(JSON.stringify(expr.json))) latex += '+C'
    return {
      kind: f.matrix && !trailingEq ? 'matrix' : trailingEq ? 'inline' : f.matrix ? 'matrix' : 'below',
      latex,
      text: latex === f.latex ? f.text : '',
      alt: f.alt,
    }
  } finally {
    ce.angularUnit = prevAngle
  }
}

export const computeEngineBackend: MathBackend = {
  id: 'cortex-compute-engine',
  compute: computeLatex,
}
