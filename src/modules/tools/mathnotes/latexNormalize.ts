const FN_NAMES = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'det', 'lim', 'max', 'min', 'gcd',
]

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
