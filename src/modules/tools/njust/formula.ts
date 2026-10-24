import {
  Math as DocxMath,
  MathAngledBrackets,
  MathCurlyBrackets,
  MathFraction,
  MathIntegral,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  type MathComponent,
} from 'docx'
import type { BinaryImage } from './types'

/**
 * LaTeX → Word 原生公式（OMML）的轻量解析器。
 * 覆盖报告里常见的分式、上下标、根式、求和/积分、希腊字母和括号；
 * 遇到 cases / matrix / 复杂宏时返回 null，由调用方用 KaTeX 截图兜底。
 */

class UnsupportedFormula extends Error {}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  partial: '∂', nabla: '∇', infty: '∞', cdot: '·', times: '×', div: '÷',
  pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠',
  approx: '≈', equiv: '≡', propto: '∝', to: '→', rightarrow: '→',
  leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', forall: '∀', exists: '∃',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′',
}

const SPACES: Record<string, string> = {
  ',': '\u2009', ';': '\u2005', ':': '\u2005', '!': '', ' ': ' ', quad: '\u2003', qquad: '\u2003\u2003',
}

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'lg', 'exp', 'max', 'min', 'lim', 'det', 'gcd'])

function tokenize(latex: string): string[] {
  const tokens: string[] = []
  let i = 0
  const s = latex.replace(/%[^\n]*/g, '').replace(/\r/g, '')
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      if (s[i + 1] === '\\') { tokens.push('\\\\'); i += 2; continue }
      let j = i + 1
      if (/[A-Za-z]/.test(s[j] ?? '')) {
        while (j < s.length && /[A-Za-z]/.test(s[j])) j++
      } else {
        j++
      }
      tokens.push(s.slice(i, j))
      i = j
      continue
    }
    if (/\s/.test(ch)) {
      while (i < s.length && /\s/.test(s[i])) i++
      tokens.push(' ')
      continue
    }
    if ('{}^_&[]()'.includes(ch)) { tokens.push(ch); i++; continue }
    tokens.push(ch)
    i++
  }
  return tokens
}

class LatexParser {
  private i = 0
  constructor(private readonly tokens: string[]) {}

  parse(): MathComponent[] {
    const out = this.sequence(false)
    if (this.i < this.tokens.length) throw new UnsupportedFormula()
    return out
  }

  private peek(): string | undefined { return this.tokens[this.i] }
  private next(): string | undefined { return this.tokens[this.i++] }

  private group(): MathComponent[] {
    if (this.next() !== '{') throw new UnsupportedFormula()
    const out = this.sequence(false)
    if (this.next() !== '}') throw new UnsupportedFormula()
    return out
  }

  private sequence(stopAtRight: boolean): MathComponent[] {
    const out: MathComponent[] = []
    while (this.i < this.tokens.length) {
      const token = this.peek()
      if (token === '}' || token === ']' || token === ')') break
      if (stopAtRight && token === '\\right') break
      if (token === '&' || token === '\\\\' || token === '\\right') throw new UnsupportedFormula()
      if (token === ' ') { this.next(); continue }
      out.push(...this.atomWithScripts())
    }
    return out
  }

  private rawGroupText(): string {
    if (this.next() !== '{') throw new UnsupportedFormula()
    let depth = 1
    let text = ''
    while (this.i < this.tokens.length) {
      const token = this.next()!
      if (token === '{') { depth++; text += '{'; continue }
      if (token === '}') { depth--; if (depth === 0) break; text += '}'; continue }
      if (token === ' ') { text += ' '; continue }
      if (token.startsWith('\\')) {
        const cmd = token.slice(1)
        if (cmd === '{') text += '{'
        else if (cmd === '}') text += '}'
        else if (cmd === ' ') text += ' '
        else text += GREEK[cmd] ?? cmd
        continue
      }
      text += token
    }
    return text
  }

  private atomWithScripts(): MathComponent[] {
    const base = this.atom()
    let sub: MathComponent[] | undefined
    let sup: MathComponent[] | undefined
    while (this.peek() === '_' || this.peek() === '^') {
      const op = this.next()
      const arg = this.scriptArgument()
      if (op === '_') sub = arg
      else sup = arg
    }
    if (sub && sup) return [new MathSubSuperScript({ children: base, subScript: sub, superScript: sup })]
    if (sub) return [new MathSubScript({ children: base, subScript: sub })]
    if (sup) return [new MathSuperScript({ children: base, superScript: sup })]
    return base
  }

  private scriptArgument(): MathComponent[] {
    if (this.peek() === '{') return this.group()
    return this.atom()
  }

  private bracket(open: string, close: string): MathComponent[] {
    this.next()
    const inner = this.sequence(false)
    if (this.next() !== close) throw new UnsupportedFormula()
    if (open === '[') return [new MathSquareBrackets({ children: inner })]
    if (open === '(') return [new MathRoundBrackets({ children: inner })]
    return inner
  }

  private atom(): MathComponent[] {
    let token = this.next()
    if (!token) throw new UnsupportedFormula()
    while (token === ' ') token = this.next()
    if (!token) throw new UnsupportedFormula()
    if (token === '{') {
      this.i--
      return this.group()
    }
    if (token === '[') { this.i--; return this.bracket('[', ']') }
    if (token === '(') { this.i--; return this.bracket('(', ')') }
    if (token === ']' || token === ')' || token === '}') throw new UnsupportedFormula()
    if (!token.startsWith('\\')) {
      if (token === '^' || token === '_') return this.scriptArgument()
      return [new MathRun(token)]
    }

    const cmd = token.slice(1)
    if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
      return [new MathFraction({ numerator: this.group(), denominator: this.group() })]
    }
    if (cmd === 'sqrt') {
      let degree: MathComponent[] | undefined
      if (this.peek() === '[') {
        this.next()
        degree = this.sequence(false)
        if (this.next() !== ']') throw new UnsupportedFormula()
      }
      return [new MathRadical({ children: this.group(), ...(degree ? { degree } : {}) })]
    }
    if (cmd === 'sum' || cmd === 'prod') {
      const sub = this.peek() === '_' ? (this.next(), this.scriptArgument()) : undefined
      const sup = this.peek() === '^' ? (this.next(), this.scriptArgument()) : undefined
      const body = this.atomWithScripts()
      if (cmd === 'prod') {
        return [new MathSubSuperScript({ children: [new MathRun('∏')], subScript: sub ?? [], superScript: sup ?? [] }), ...body]
      }
      return [new MathSum({ children: body, ...(sub ? { subScript: sub } : {}), ...(sup ? { superScript: sup } : {}) })]
    }
    if (cmd === 'int') {
      const sub = this.peek() === '_' ? (this.next(), this.scriptArgument()) : undefined
      const sup = this.peek() === '^' ? (this.next(), this.scriptArgument()) : undefined
      const body = this.atomWithScripts()
      return [new MathIntegral({ children: body, ...(sub ? { subScript: sub } : {}), ...(sup ? { superScript: sup } : {}) })]
    }
    if (cmd === 'left') {
      const open = this.next()
      if (!open) throw new UnsupportedFormula()
      const inner = this.sequence(true)
      if (this.next() !== '\\right') throw new UnsupportedFormula()
      const close = this.next()
      if (!close) throw new UnsupportedFormula()
      if (open === '(' && close === ')') return [new MathRoundBrackets({ children: inner })]
      if (open === '[' && close === ']') return [new MathSquareBrackets({ children: inner })]
      if (open === '\\{' && close === '\\}') return [new MathCurlyBrackets({ children: inner })]
      if (open === '\\langle' && close === '\\rangle') return [new MathAngledBrackets({ children: inner })]
      if (open === '.' && close === '.') return inner
      return [new MathRun(open === '\\{' ? '{' : open), ...inner, new MathRun(close === '\\}' ? '}' : close)]
    }
    if (cmd === 'text' || cmd === 'textrm' || cmd === 'mbox') {
      return [new MathRun({ text: this.rawGroupText(), normalText: true })]
    }
    if (cmd === 'mathrm' || cmd === 'mathbf' || cmd === 'mathit' || cmd === 'boldsymbol') {
      const style = cmd === 'mathrm' ? 'plain' : cmd === 'mathit' ? 'italic' : cmd === 'boldsymbol' ? 'boldItalic' : 'bold'
      return [new MathRun({ text: this.rawGroupText(), style })]
    }
    if (cmd === 'mathbb') {
      return [new MathRun({ text: this.rawGroupText(), script: 'doubleStruck' })]
    }
    if (cmd === 'mathcal' || cmd === 'mathscr') {
      return [new MathRun({ text: this.rawGroupText(), script: 'script' })]
    }
    if (FUNCTIONS.has(cmd)) {
      return [new MathRun({ text: cmd, normalText: true })]
    }
    if (SPACES[cmd] !== undefined) return SPACES[cmd] ? [new MathRun(SPACES[cmd])] : []
    if (GREEK[cmd]) return [new MathRun(GREEK[cmd])]
    if (cmd === 'begin' || cmd === 'end' || cmd === 'overline' || cmd === 'underline' || cmd === 'hat' || cmd === 'vec' || cmd === 'bar' || cmd === 'matrix') {
      throw new UnsupportedFormula()
    }
    // 未知命令交给图片兜底，避免把公式吞成半截
    throw new UnsupportedFormula()
  }
}

export function latexToMath(latex: string): MathComponent[] | null {
  const source = latex.trim()
  if (!source) return null
  try {
    return new LatexParser(tokenize(source)).parse()
  } catch {
    return null
  }
}

export function mathNode(components: MathComponent[]): DocxMath {
  return new DocxMath({ children: components })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 不支持的公式用 KaTeX 渲染成 PNG；离线、WebView 内也能跑。 */
export async function renderFormulaPng(latex: string, display: boolean): Promise<BinaryImage | null> {
  if (typeof document === 'undefined') return null
  try {
    const katex = (await import('katex')).default
    const { toPng } = await import('html-to-image')
    const holder = document.createElement('div')
    // html-to-image 会克隆节点；节点在视口外时克隆内容会落到画布外，截出白图。
    // 放到原点、压到背景层下面，截图期间不可见，但克隆坐标有效。
    holder.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;display:inline-block;padding:8px;background:#fff;color:#000;font-size:18px;line-height:1.25;pointer-events:none;'
    holder.innerHTML = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: false, output: 'html' })
    document.body.appendChild(holder)
    await document.fonts?.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const rect = holder.getBoundingClientRect()
    const dataUrl = await toPng(holder, { pixelRatio: 3, backgroundColor: '#ffffff', cacheBust: true })
    holder.remove()
    return { data: dataUrlToBytes(dataUrl), type: 'png', width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
  } catch {
    return null
  }
}
