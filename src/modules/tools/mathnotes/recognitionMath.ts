import { computeLatex } from './compute'
import type { ComputeResult } from './types'
import { columnExpression, recognizeInk, type InkRecognition } from './inkRecognize'

export { columnExpression, recognizeInk, type InkRecognition }

/** 大括号存在但方程未识别全时，不能把单行的结果当作整个方程组的解。 */
export function computeRecognized(out: InkRecognition): ComputeResult {
  return out.incompleteSystem
    ? { kind: 'error', latex: '', text: '', message: '方程组未识别完整，点击后按行修改各个等式' }
    : computeLatex(out.latex)
}
