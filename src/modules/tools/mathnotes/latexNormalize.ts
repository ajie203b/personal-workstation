const FN_NAMES = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'det', 'lim', 'max', 'min', 'gcd',
]

/** 数学保留函数名与常量名，不可作为页面变量名赋值 */
export const RESERVED_CONSTANTS = new Set(['i', 'e', 'pi', '\\pi'])
export const RESERVED_VAR_NAMES = new Set([
  ...FN_NAMES,
  'lg',
  'sqrt',
  'abs',
  'pi',
  'i',
  'e',
  'inf',
  'infty',
  'nan',
])

/** 归一化变量名（如 v_{0} -> v_0） */
export function canonicalVarName(name: string): string {
  return name.trim().replace(/_\{\s*([a-zA-Z0-9]+)\s*\}/g, '_$1')
}

export function isReservedVarName(rawName: string): boolean {
  const c = canonicalVarName(rawName)
  if (RESERVED_CONSTANTS.has(c)) return true
  if (c === 'i' || c === 'e') return true
  if (RESERVED_VAR_NAMES.has(c.toLowerCase()) && c.length > 1) return true
  return false
}

function formatVarNumberForLatex(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Object.is(n, -0)) return '0'
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 1e-8 && abs < 1e15) {
    // 避免 JS 输出 1e-7 被 LaTeX 解析成 1 * e - 7
    const fixed = Number(n.toPrecision(12))
    const str = fixed.toString()
    if (!/[eE]/.test(str)) return str
    return fixed.toFixed(12).replace(/\.?0+$/, '')
  }
  const [mant, exp] = n.toExponential(10).split('e')
  return `${mant.replace(/\.?0+$/, '')}\\times 10^{${Number(exp)}}`
}

/**
 * 在规范化后的 LaTeX 中替换已定义的多字符 / 下标 / 单字符独立变量，并检测引用到的错误变量。
 * 保留 \sin、\frac、\begin{...} 等 LaTeX 命令不被误伤。
 */
export function substituteVarsInLatex(
  normalizedLatex: string,
  variables: Record<string, number>,
  invalidVariables?: Set<string>,
): { latex: string; invalidRef?: string; replaced: boolean } {
  const hasVars = Object.keys(variables).length > 0
  const hasInvalid = Boolean(invalidVariables?.size)
  if (!hasVars && !hasInvalid) return { latex: normalizedLatex, replaced: false }

  const tokenRe = /(\\(?:begin|end)\s*\{[^{}]*\})|(\\[a-zA-Z]+)|([a-zA-Z][a-zA-Z0-9]*(?:_(?:\{[a-zA-Z0-9]+\}|[a-zA-Z0-9]+))?)/g
  let invalidRef: string | undefined
  let replaced = false
  const latex = normalizedLatex.replace(tokenRe, (full, env: string | undefined, cmd: string | undefined, ident: string | undefined, offset: number, src: string) => {
    if (env || cmd || !ident) return full
    const canon = canonicalVarName(ident)
    if (invalidVariables?.has(canon)) {
      invalidRef ??= canon
      return full
    }
    if (Object.prototype.hasOwnProperty.call(variables, canon)) {
      replaced = true
      const valStr = formatVarNumberForLatex(variables[canon])
      const prev = offset > 0 ? src[offset - 1] : ''
      if (prev === '^' || prev === '_') return `{(${valStr})}`
      return `(${valStr})`
    }
    return full
  })
  return { latex, invalidRef, replaced }
}

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
  // 仅在纯数字四则表达式中，把紧邻数字的 O 纠正为 0；含变量的表达式保持原样。
  if (/^[\dO\s.+\-*/=×÷]+$/.test(s) && /\d/.test(s)) {
    s = s.replace(/(?<=\d)O|O(?=\d)/g, '0')
  }
  s = s.replace(/−|﹣/g, '-').replace(/＋/g, '+').replace(/／/g, '/')
  // 排版空白
  s = s.replace(/\\(?:!|,|;|:|quad|qquad|enspace|thinspace)/g, ' ').replace(/\\ /g, ' ')
  s = s.replace(/\\displaystyle|\\textstyle/g, '')
  // 全角 / Unicode 运算符
  s = s.replace(/×/g, '\\times ').replace(/÷/g, '\\div ').replace(/（/g, '(').replace(/）/g, ')').replace(/＝/g, '=')
  // \mathrm{sin} → \sin；\textsc{x} / \textsc x → x；\operatorname*{lim} → \lim
  const bracedWrapRe = /\\(?:mathrm|operatorname\s*\*?|textrm|textit|textbf|textsc|mathsf|texttt|textnormal|mathit|mathbf|boldsymbol|text)\s*\{\s*([^{}]*?)\s*\}/g
  const unwrapInner = (_: string, inner: string) => {
    const name = inner.replace(/\s+/g, '')
    if (FN_NAMES.includes(name)) return `\\${name} `
    if (name === 'lg') return '\\log_{10} '
    return name
  }
  s = s.replace(bracedWrapRe, unwrapInner).replace(bracedWrapRe, unwrapInner)
  s = s.replace(/\\(?:mathrm|textrm|textit|textbf|textsc|mathsf|texttt|textnormal|mathit|mathbf|boldsymbol|text)\s+(\\[a-zA-Z]+|[a-zA-Z0-9])/g, '$1')
  s = s.replace(/\\(lim|max|min|log)\s+(?=[_^])/g, '\\$1')
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
  // 手写或识别紧连单位的 \tom / \tokm 补空格，避免 KaTeX 把 \tom 当成未定义宏
  s = s.replace(/\\to(?=(?:km|cm|mm|dm|um|nm|m|kg|mg|g|ml|l|ms|s|min|h|kb|mb|gb|tb|b)\b)/gi, '\\to ')
  return s.replace(/\s{2,}/g, ' ').trim()
}
