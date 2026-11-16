import { computeLatex, formatNumber, getComputeEngine, normalizeLatex } from './compute'
import { canonicalVarName, isReservedVarName, substituteVarsInLatex } from './latexNormalize'
import type { AngleMode, ComputeResult } from './types'
import { computeUnits } from './units'

export interface PageEntry { key: string; latex: string }
export interface PageEvaluation { variables: Record<string, number>; results: Record<string, ComputeResult> }

const ASSIGN_RE = /^([a-zA-Z][a-zA-Z0-9]*(?:_(?:\{[a-zA-Z0-9]+\}|[a-zA-Z0-9]+))?|\\pi)\s*[=＝]\s*(.+)$/s

function referencesInvalidVariable(
  normLatex: string,
  invalidVariables: Set<string>,
  ce: ReturnType<typeof getComputeEngine>,
): boolean {
  if (!invalidVariables.size) return false
  if (substituteVarsInLatex(normLatex, {}, invalidVariables).invalidRef) return true
  const rows = /\\begin\s*\{/.test(normLatex)
    ? [normLatex]
    : normLatex.split(/\r?\n|(?<!\\)[;；]/).map((r) => r.trim()).filter(Boolean)
  for (const row of rows) {
    const clean = row.replace(/=\s*$/, '').trim()
    if (!clean) continue
    try {
      const expr = ce.parse(clean)
      if (expr?.isValid && expr.unknowns.some((u) => invalidVariables.has(u))) return true
    } catch { /* ignore */ }
  }
  return false
}

/** 按页面阅读顺序计算；声明只作用于之后的表达式，避免未来的赋值改变前文含义。 */
export function evaluatePage(entries: PageEntry[], opts: { angleMode?: AngleMode } = {}): PageEvaluation {
  const ce = getComputeEngine()
  const angleMode = opts.angleMode ?? 'rad'
  const prevAngle = ce.angularUnit
  ce.angularUnit = angleMode
  const variables: Record<string, number> = {}
  const invalidVariables = new Set<string>()
  const results: Record<string, ComputeResult> = {}

  try {
    for (const entry of entries) {
      const raw = entry.latex.trim()
      const unitResult = computeUnits(raw, { definedVars: new Set(Object.keys(variables)) })
      if (unitResult) {
        results[entry.key] = unitResult
        continue
      }

      const normRaw = normalizeLatex(raw)
      const assignment = normRaw.match(ASSIGN_RE)
      if (assignment && !assignment[2].includes('=') && !assignment[2].includes('\n')) {
        const name = canonicalVarName(assignment[1])
        const rhs = assignment[2].trim()
        // 保留常量 i / e（若右侧也含复数 i / e 可能是恒等验算，否则给出清晰提示）
        const isComplexCheck = (name === 'i' && /(?:^|[^a-zA-Z\\])i(?![a-zA-Z])|\\imaginaryI/.test(rhs))
          || (name === 'e' && /(?:^|[^a-zA-Z\\])e(?![a-zA-Z])|\\exponentialE/.test(rhs))
        if (!isComplexCheck && isReservedVarName(name)) {
          results[entry.key] = {
            kind: 'error',
            latex: '',
            text: '',
            message: `「${name === '\\pi' ? 'π' : name}」是数学保留常量或函数名，不能作为变量赋值`,
          }
          continue
        }
        if (!isComplexCheck) {
          try {
            const sub = substituteVarsInLatex(rhs, variables, invalidVariables)
            if (sub.invalidRef) throw new Error('引用的变量赋值有误，请先修正')
            const expr = ce.parse(sub.latex)
            if (!expr || !expr.isValid || expr.unknowns.some((u) => !(u in variables))) {
              throw new Error('变量值无法计算，请先定义引用的变量')
            }
            const result = expr.subs(variables).N()
            if (!Number.isFinite(result.re) || (result.im != null && result.im !== 0)) {
              throw new Error('变量值必须是有限实数')
            }
            variables[name] = result.re
            invalidVariables.delete(name)
            results[entry.key] = {
              kind: 'none',
              latex: '',
              text: '',
              assigned: { name, value: formatNumber(result.re).text },
            }
          } catch (e) {
            delete variables[name]
            invalidVariables.add(name)
            results[entry.key] = {
              kind: 'error',
              latex: '',
              text: '',
              message: e instanceof Error ? e.message : '变量值无法计算，请先定义引用的变量',
            }
          }
          continue
        }
      }

      if (referencesInvalidVariable(normRaw, invalidVariables, ce)) {
        results[entry.key] = { kind: 'error', latex: '', text: '', message: '引用的变量赋值有误，请先修正' }
        continue
      }

      results[entry.key] = computeLatex(raw, { angleMode, variables })
    }
    return { variables, results }
  } finally {
    ce.angularUnit = prevAngle
  }
}
