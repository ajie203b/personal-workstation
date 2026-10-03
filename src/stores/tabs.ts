import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DocTab {
  id: string
  title: string
}

interface TabsState {
  tabs: DocTab[]
  open: (id: string, title: string) => void
  close: (id: string) => string | null // 返回应切换到的邻居 id
}

/** 多标签阅读（M2.5）：打开顺序持久化，关一个自动切到邻居 */
export const useDocTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      open: (id, title) =>
        set((s) => {
          const exists = s.tabs.find((t) => t.id === id)
          if (exists) {
            return { tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) }
          }
          return { tabs: [...s.tabs, { id, title }].slice(-8) } // 最多 8 个标签
        }),
      close: (id) => {
        const tabs = get().tabs
        const idx = tabs.findIndex((t) => t.id === id)
        const next = tabs.filter((t) => t.id !== id)
        set({ tabs: next })
        if (idx >= 0) return next[Math.min(idx, next.length - 1)]?.id ?? null
        return null
      },
    }),
    { name: 'ws-doc-tabs' },
  ),
)
