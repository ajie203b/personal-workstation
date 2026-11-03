/** 主线程 ⇄ 手写计算 Worker 的消息格式 */
import type { ComputeResult, Stroke } from './types'
import type { ModelSourceConfig } from './recognizer'

export type WorkerIn =
  | { type: 'config'; source: ModelSourceConfig }
  | { type: 'load'; id: number }
  | { type: 'recognize'; id: number; key: string; strokes: Stroke[]; charHeight: number }
  | { type: 'compute'; id: number; key: string; latex: string }

export type WorkerOut =
  | { type: 'progress'; id: number; ratio: number; file: string }
  | { type: 'loaded'; id: number; backend: string }
  | { type: 'recognized'; id: number; key: string; latex: string; confidence: number; ms: number; result: ComputeResult }
  | { type: 'computed'; id: number; key: string; result: ComputeResult }
  | { type: 'error'; id: number; message: string }
