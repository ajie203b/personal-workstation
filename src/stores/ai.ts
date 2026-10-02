import { create } from 'zustand'

export interface RunningTask {
  sessionId: string
  title: string
  model: string
  providerName: string
  startedAt: number
  tokens: number
  controller: AbortController
}

interface AiState {
  running: Record<string, RunningTask>
  start: (t: RunningTask) => void
  updateTokens: (sessionId: string, total: number) => void
  stop: (sessionId: string) => void
  finish: (sessionId: string) => void
}

/** 运行中任务卡片数据源（方案 2.3：脉冲 + token 实时数 + Stop） */
export const useAi = create<AiState>((set, get) => ({
  running: {},
  start: (t) => set((s) => ({ running: { ...s.running, [t.sessionId]: t } })),
  updateTokens: (sessionId, total) =>
    set((s) => {
      const cur = s.running[sessionId]
      if (!cur) return s
      return { running: { ...s.running, [sessionId]: { ...cur, tokens: total } } }
    }),
  stop: (sessionId) => {
    get().running[sessionId]?.controller.abort()
  },
  finish: (sessionId) =>
    set((s) => {
      const next = { ...s.running }
      delete next[sessionId]
      return { running: next }
    }),
}))
