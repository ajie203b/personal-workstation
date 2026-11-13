/** 主线程 ⇄ 手写计算 Worker 的消息格式 */
import type { ComputeResult, Stroke } from './types'
import type { ModelSourceConfig } from './recognizer'
import type { PlotCurve } from './plot'
import type { PageEntry, PageEvaluation } from './variables'

export type WorkerIn =
  | { type: 'config'; source: ModelSourceConfig }
  /** fresh：先释放会话、清掉未通过校验的缓存文件，再加载（只补下缺的 / 坏的；「重试 / 重新加载模型」按钮） */
  | { type: 'load'; id: number; fresh?: boolean }
  | { type: 'recognize'; id: number; key: string; strokes: Stroke[]; charHeight: number }
  | { type: 'compute'; id: number; key: string; latex: string }
  | { type: 'evaluatePage'; id: number; entries: PageEntry[] }
  | { type: 'plot'; id: number; latex: string; min: number; max: number; count: number; tMin?: number; tMax?: number; variables?: Record<string, number>; centerX?: number; centerY?: number }

export type WorkerOut =
  | { type: 'progress'; id: number; ratio: number; file: string }
  | { type: 'loaded'; id: number; backend: string }
  | { type: 'recognizedRaw'; id: number; key: string; latex: string; confidence: number; ms: number; incompleteSystem?: boolean }
  | { type: 'computed'; id: number; key: string; result: ComputeResult }
  | { type: 'pageEvaluated'; id: number; evaluation: PageEvaluation }
  | { type: 'plotted'; id: number; curves: PlotCurve[] }
  | { type: 'error'; id: number; message: string }
