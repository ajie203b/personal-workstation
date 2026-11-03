/**
 * LaTeX → 计算结果。主力是 CortexJS Compute Engine（直接解析 LaTeX，纯 JS，离线）：
 * 四则、三角（含角度 °）、对数、复数、阶乘、组合数、解方程/方程组、求导、定积分/不定积分、
 * 极限、求和、矩阵乘法/求逆/转置/行列式都能覆盖。
 *
 * 处理流程：
 * 1. normalizeLatex：把识别模型的输出整理成 Compute Engine 好懂的写法
 *    （去 \! \, 等排版空白、数字间空格、\mathrm 包裹，C_n^k / A_n^k 组合排列记号，竖式展平…）；
 * 2. 判断形态：以「=」结尾 → 求值，答案写在等号后；中间带「=」→ 解方程（组）；
 *    矩阵 → 结果画在下方；其余只是算式，不打扰；
 * 3. 格式化：整数 / 分数给精确值，根式、π、对数等补一个近似小数；矩阵转 pmatrix。
 *
 * 以后要接 Giac（wasm，体积约 10MB+）处理更重的符号运算，实现同样的 MathBackend 接口即可。
 */
import { ComputeEngine } from '@cortex-js/compute-engine'
import type { ComputeResult } from './types'

export interface MathBackend {
  readonly id: string
  compute(latex: string): ComputeResult
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
  evaluate(): Expr
  N(): Expr
  simplify(): Expr
}

let engine: ComputeEngine | null = null
const engineRef = {
  parse(latex: string): Expr {
    engine ??= new ComputeEngine()
    const e = engine.parse(latex) as unknown as Expr | null
    if (!e) throw new Error('解析失败')
    return e
  },
  box(json: unknown): Expr {
    engine ??= new ComputeEngine()
    return engine.box(json as never) as unknown as Expr
  },
}

/* ============ 1. 规范化 ============ */

const FN_NAMES = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'det', 'lim', 'max', 'min', 'gcd']

/** 取一个 LaTeX 参数：{...} 或单个字符；返回 [内容, 结束下标] */
function readArg(s: string, i: number): [string, number] | null {
  while (s[i] === ' ') i++
  if (s[i] === '{') {
    let depth = 0
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++
      else if (s[j] === '}') {
        depth--
        if (depth === 0) return [s.slice(i + 1, j), j + 1]
      }
    }
    return null
  }
  if (i < s.length) return [s[i], i + 1]
  return null
}

/** C_n^k / C_{n}^{k} / \mathrm{C}_n^k（中国教材写法，上标在前也行）→ \binom ；A_n^k / P_n^k → 排列数 */
function rewriteCombinatorics(s: string): string {
  const re = /(?<![a-zA-Z\\])([CAP])(?=\s*[_^])/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    let i = m.index + 1
    let sub: string | null = null
    let sup: string | null = null
    for (let k = 0; k < 2; k++) {
      while (s[i] === ' ') i++
      const mark = s[i]
      if (mark !== '_' && mark !== '^') break
      const arg = readArg(s, i + 1)
      if (!arg) break
      if (mark === '_') sub = arg[0]
      else sup = arg[0]
      i = arg[1]
    }
    if (sub == null || sup == null) continue
    const n = sub.trim()
    const k = sup.trim()
    // 只在 n、k 是数字或单个字母时改写，避免误伤普通的带上下标变量
    if (!/^(\d+|[a-z])$/.test(n) || !/^(\d+|[a-z])$/.test(k)) continue
    const rep = m[1] === 'C' ? `\\binom{${n}}{${k}}` : `\\frac{${n}!}{(${n}-${k})!}`
    out += s.slice(last, m.index) + rep
    last = i
    re.lastIndex = i
  }
  return out + s.slice(last)
}

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

/**
 * 竖式展平：每行是一个数（可带 + - × ÷ 前缀）时，按前缀串成一条算式（无前缀视为 +）。
 * 例：123 \\ +456 \\ \hline → 123+456
 */
export function flattenColumnArithmetic(rows: string[]): string | null {
  if (rows.length < 2) return null
  const parts: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].replace(/\s+/g, '')
    const m = r.match(/^(\+|-|\\times|\\div|\\cdot)?(\d+(?:\.\d+)?)$/)
    if (!m) return null
    const op = m[1] ?? (i === 0 ? '' : '+')
    parts.push(`${i === 0 ? (m[1] === '-' ? '-' : '') : op}${m[2]}`)
  }
  return parts.join('')
}

export function normalizeLatex(raw: string): string {
  let s = raw.trim()
  // 排版空白
  s = s.replace(/\\(?:!|,|;|:|quad|qquad|enspace|thinspace)/g, ' ').replace(/\\ /g, ' ')
  s = s.replace(/\\displaystyle|\\textstyle/g, '')
  // 全角 / Unicode 运算符
  s = s.replace(/×/g, '\\times ').replace(/÷/g, '\\div ').replace(/（/g, '(').replace(/）/g, ')').replace(/＝/g, '=')
  // \mathrm{sin} → \sin；\mathrm{d} → d；其余 \mathrm{X} → X
  s = s.replace(/\\(?:mathrm|operatorname|textrm|mathit|mathbf|boldsymbol|text)\s*\{\s*([^{}]*?)\s*\}/g, (_, inner: string) => {
    const name = inner.replace(/\s+/g, '')
    if (FN_NAMES.includes(name)) return `\\${name} `
    if (name === 'lg') return '\\log_{10} '
    return name
  })
  s = s.replace(/\\lg(?![a-zA-Z])/g, '\\log_{10}')
  // \dfrac / \tfrac
  s = s.replace(/\\[dt]frac/g, '\\frac')
  // 数字之间的空格（模型常输出 "1 2" 表示 12）
  for (let k = 0; k < 3; k++) s = s.replace(/(\d)\s+(?=[\d.])/g, '$1').replace(/(\.)\s+(?=\d)/g, '$1')
  // 组合排列
  s = rewriteCombinatorics(s)
  // 纯数字之间写成 x 的乘号（如 3x4），仅当整条式子没有别的字母时
  const letters = s.replace(/\\[a-zA-Z]+/g, '').match(/[a-zA-Z]/g) ?? []
  if (letters.length && letters.every((c) => c === 'x' || c === 'X')) {
    if (/\d\s*[xX]\s*\d/.test(s) && !/[xX]\s*(?:[+\-=^)]|$)/.test(s.replace(/\d\s*[xX]\s*\d/g, ''))) {
      s = s.replace(/(\d)\s*[xX]\s*(?=\d)/g, '$1\\times ')
    }
  }
  // 手写的 x 常被认成乘号：「×」后面紧跟运算符 / 右括号 / 结尾时，它其实是变量 x
  s = s.replace(/\\times\s*(?=[+\-=)]|\\right|$)/g, 'x')
  // \left. \right. 之类空定界
  s = s.replace(/\\left\s*\.|\\right\s*\./g, '')
  return s.replace(/\s{2,}/g, ' ').trim()
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
      if (Math.abs(re) >= 1e15) return { latex: tidyLatex(e.latex), text: '' , alt: n.text }
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
  const target = unknowns.length === 1 ? unknowns[0] : ['List', ...unknowns]
  const system = equations.length === 1 ? equations[0].json : ['List', ...equations.map((e) => e.json)]
  const res = engineRef.box(['Solve', system, target]).evaluate()
  if (res.operator === 'Solve' || invalid(res)) return error('这个方程暂时解不出来，可点开修改后重试')
  const sols = res.operator === 'List' ? [...(res.ops ?? [])] : [res]
  if (!sols.length) return { kind: 'solutions', latex: '\\text{无解}', text: '无解' }
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

/** 主入口：LaTeX → 结果 */
export function computeLatex(raw: string): ComputeResult {
  let s = normalizeLatex(raw)
  if (!s) return { kind: 'none', latex: '', text: '' }

  // 多行环境：竖式 / 方程组
  // 方程组常被识别成 \left\{\begin{array}…\end{array}\right.（\right. 已在规范化时去掉）
  const stacked = splitRows(s.replace(/^(?:\\left\s*)?\\\{\s*/, '').trim())
  if (stacked && stacked.env !== 'matrix' && !(stacked.columns && !stacked.rows.some((r) => r.includes('=')))) {
    const flat = flattenColumnArithmetic(stacked.rows)
    if (flat) s = `${flat}=`
    else if (stacked.rows.some((r) => r.includes('='))) {
      const eqs = stacked.rows.filter((r) => r.includes('=')).map((r) => engineRef.parse(r))
      if (eqs.some(invalid)) return error('方程组没认全，点开修改后重试')
      return solve(eqs)
    }
  }

  const trailingEq = /=\s*$/.test(s)
  const body = s.replace(/=\s*$/, '').trim()
  if (!body) return { kind: 'none', latex: '', text: '' }

  // 中间有等号：方程（或「2+2=4」这种验算）
  if (!trailingEq && body.includes('=')) {
    const parts = body.split(/(?<![<>!\\])=/)
    if (parts.length === 2) {
      const eq = engineRef.parse(body)
      if (invalid(eq) || eq.operator !== 'Equal') return error('没认出这个方程，点开修改后重试')
      return solve([eq])
    }
    return error('一行里有多个等号，暂不支持')
  }

  let expr: Expr
  try {
    expr = engineRef.parse(body)
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
    if (value.unknowns?.length && !hasCalculus(expr)) {
      // 含未知数的代数式：展开化简
      value = engineRef.box(['Expand', value.json]).evaluate().simplify()
    }
  } catch (e) {
    return error(e instanceof Error ? `计算失败：${e.message}` : '计算失败')
  }
  if (invalid(value)) return error('这个算式暂时算不了')
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
}

export const computeEngineBackend: MathBackend = {
  id: 'cortex-compute-engine',
  compute: computeLatex,
}
