import { computeLatex, flattenColumnArithmetic, normalizeLatex } from './compute'
import type { ComputeResult } from './types'
import { columnRows, systemRows, detectTrailingEquals } from './geometry'
import { recoverTrailingEquals } from './mathText'
import type { RecognizeOutput } from './recognizer'
import type { Stroke } from './types'

/** 分行后只接受明确的数字与运算符；缺失操作符时交还用户纠错。 */
export function columnExpression(rawRows: string[]): string | null {
  if (rawRows.length !== 2) return null
  const lines = rawRows.map(row => normalizeLatex(row).replace(/\s+/g, ''))
  lines[1] = lines[1].replace(/^[xX](?=\d)/, '\\times')
  if (!/^(?:[+\-]|\\times|\\div|\\cdot)/.test(lines[1])) return null
  const flat = flattenColumnArithmetic(lines)
  return flat ? `${flat}=` : null
}

/** 竖式优先识别两行；解析不确定或分行失败时保留完整笔迹的识别结果。 */
export type InkRecognition = RecognizeOutput & { incompleteSystem?: boolean }

/** 大括号存在但方程未识别全时，不能把单行的结果当作整个方程组的解。 */
export function computeRecognized(out: InkRecognition): ComputeResult {
  return out.incompleteSystem
    ? { kind: 'error', latex: '', text: '', message: '方程组未识别完整，点击后按行修改各个等式' }
    : computeLatex(out.latex)
}

export async function recognizeInk(strokes: Stroke[], charHeight: number, recognize: (ink: Stroke[]) => Promise<RecognizeOutput>): Promise<InkRecognition> {
  const system = systemRows(strokes, charHeight)
  const partialRows: string[] = []
  if (system) {
    try {
      const rows: RecognizeOutput[] = []
      for (const row of system.rows) {
        const recognized = await recognize(row)
        rows.push(recognized)
        partialRows.push(recognized.latex)
      }
      if (rows.every(row => (row.latex.match(/[=＝]/g) ?? []).length === 1 && !/[=＝]\s*$/.test(row.latex))) {
        return { latex: rows.map(row => row.latex).join('\n'), confidence: Math.min(...rows.map(row => row.confidence)), ms: rows.reduce((sum, row) => sum + row.ms, 0) }
      }
    } catch {
      // 单行识别失败时回退为整块识别。
    }
  }
  const column = system ? null : columnRows(strokes, charHeight)
  if (column) {
    try {
      const first = await recognize(column.rows[0])
      const second = await recognize(column.rows[1])
      const latex = columnExpression([first.latex, second.latex])
      if (latex) return { latex, confidence: Math.min(first.confidence, second.confidence), ms: first.ms + second.ms }
    } catch {
      // 单行识别失败仍可尝试整块。
    }
  }
  const out = await recognize(strokes)
  if (system) {
    const completeEnvironment = /\\begin\{(?:cases|array|aligned|gathered)\}/.test(out.latex) && (out.latex.match(/\\\\/g) ?? []).length >= system.rows.length - 1
    if (!completeEnvironment) return { ...out, latex: partialRows.length === system.rows.length ? partialRows.join('\n') : out.latex, incompleteSystem: true }
    return out
  }
  return { ...out, latex: column ? out.latex : recoverTrailingEquals(out.latex, Boolean(detectTrailingEquals(strokes, charHeight))) }
}
