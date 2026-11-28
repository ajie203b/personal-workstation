import type { BlockResult, NoteGraph } from './types'

/**
 * 将手写计算页的识别公式、计算结果、已定义变量与函数图像导出为标准 Markdown 文档，
 * 供直接存入 Kairos 文档库继续整理、批注或转 NJUST 报告。
 */
export function buildMathNoteMarkdown(opts: {
  title: string
  results: readonly BlockResult[]
  variables?: Readonly<Record<string, number>>
  graphs?: readonly NoteGraph[]
  exportedAt?: string
}): string {
  const title = opts.title.trim() || '手写计算笔记'
  const lines: string[] = [`# ${title}`, '']

  const varEntries = Object.entries(opts.variables ?? {})
  if (varEntries.length > 0) {
    lines.push('## 已定义变量', '')
    for (const [name, value] of varEntries) {
      lines.push(`- $${name} = ${value}$`)
    }
    lines.push('')
  }

  const validResults = opts.results.filter(
    (item) => item.edited?.trim() || item.recognized.trim() || item.result.latex.trim() || item.result.text.trim(),
  )
  if (validResults.length > 0) {
    lines.push('## 算式与推导结果', '')
    for (const item of validResults) {
      const expr = item.edited?.trim() || item.recognized.trim()
      const r = item.result
      if (r.kind === 'error') {
        if (expr) lines.push('$$', expr, '$$', '')
        continue
      }
      if (r.assigned) {
        lines.push('$$', `${r.assigned.name} = ${r.assigned.value}`, '$$', '')
        continue
      }
      const answerLatex = r.latex.trim()
      if (expr && answerLatex) {
        const cleanExpr = expr.replace(/=\s*$/, '').trim()
        if (r.kind === 'inline') {
          lines.push('$$', `${cleanExpr} = ${answerLatex}`, '$$')
        } else {
          lines.push('$$', cleanExpr, '$$', '', '$$', answerLatex, '$$')
        }
        if (r.alt) lines.push(`> 近似值：$${r.alt}$`)
        lines.push('')
      } else if (expr) {
        lines.push('$$', expr, '$$', '')
      } else if (answerLatex) {
        lines.push('$$', answerLatex, '$$', '')
      }
    }
  }

  const graphs = opts.graphs ?? []
  if (graphs.length > 0) {
    lines.push('## 函数图像', '')
    for (const g of graphs) {
      const cx = (g.centerX ?? 0).toFixed(1)
      const cy = (g.centerY ?? 0).toFixed(1)
      lines.push(`- \`${g.expression}\`（视窗中心 (${cx}, ${cy})，范围 ±${g.range}）`)
    }
    lines.push('')
  }

  if (validResults.length === 0 && varEntries.length === 0 && graphs.length === 0) {
    lines.push('_本页暂无可导出的识别算式或函数图像。_', '')
  }

  if (opts.exportedAt) {
    lines.push(`> 导出自 Kairos 手写计算 · ${opts.exportedAt}`, '')
  }

  return lines.join('\n')
}
