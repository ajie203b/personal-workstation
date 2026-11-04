import { ComputeEngine } from '@cortex-js/compute-engine'
import { computeLatex, normalizeLatex } from './compute'
import type { ComputeResult } from './types'
import { computeUnits } from './units'

export interface PageEntry { key: string; latex: string }
export interface PageEvaluation { variables: Record<string, number>; results: Record<string, ComputeResult> }

/** 按页面阅读顺序计算；声明只作用于之后的表达式，避免未来的赋值改变前文含义。 */
export function evaluatePage(entries: PageEntry[]): PageEvaluation {
  const ce = new ComputeEngine()
  const variables: Record<string, number> = {}
  const invalidVariables = new Set<string>()
  const results: Record<string, ComputeResult> = {}
  for (const entry of entries) {
    const raw = entry.latex.trim()
    const unitResult = computeUnits(raw)
    if (unitResult) { results[entry.key] = unitResult; continue }
    const assignment = raw.match(/^([a-zA-Z])\s*[=＝]\s*(.+)$/s)
    if (assignment && !assignment[2].includes('=') && !assignment[2].includes('\n')) {
      try {
        const expr = ce.parse(normalizeLatex(assignment[2]))
        if (!expr || !expr.isValid || expr.unknowns.some(name => !(name in variables))) throw new Error('请先定义引用的变量')
        const result = expr.subs(variables).N()
        if (!Number.isFinite(result.re) || (result.im != null && result.im !== 0)) throw new Error('变量值必须是有限实数')
        variables[assignment[1]] = result.re
        invalidVariables.delete(assignment[1])
        results[entry.key] = { kind: 'none', latex: '', text: '' }
      } catch {
        delete variables[assignment[1]]
        invalidVariables.add(assignment[1])
        results[entry.key] = { kind: 'error', latex: '', text: '', message: '变量值无法计算，请先定义引用的变量' }
      }
      continue
    }
    const trailing = /=\s*$/.test(raw)
    const body = trailing ? raw.replace(/=\s*$/, '') : raw
    if (trailing && (Object.keys(variables).length || invalidVariables.size)) {
      try {
        const expr = ce.parse(normalizeLatex(body))
        if (expr?.isValid && expr.unknowns.some(name => invalidVariables.has(name))) {
          results[entry.key] = { kind: 'error', latex: '', text: '', message: '引用的变量赋值有误，请先修正' }
          continue
        }
        if (expr?.isValid && expr.unknowns.some(name => name in variables)) {
          results[entry.key] = computeLatex(`${expr.subs(variables).latex}=`)
          continue
        }
      } catch { /* 交给常规计算给出提示 */ }
    }
    results[entry.key] = computeLatex(raw)
  }
  return { variables, results }
}
