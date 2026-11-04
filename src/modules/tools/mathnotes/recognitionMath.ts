import { flattenColumnArithmetic, normalizeLatex } from './compute'
import { columnRows, detectTrailingEquals } from './geometry'
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
export async function recognizeInk(strokes: Stroke[], charHeight: number, recognize: (ink: Stroke[]) => Promise<RecognizeOutput>): Promise<RecognizeOutput> {
  const column = columnRows(strokes, charHeight)
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
  return { ...out, latex: column ? out.latex : recoverTrailingEquals(out.latex, Boolean(detectTrailingEquals(strokes, charHeight))) }
}
