import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'system' | 'light' | 'dark'

export interface ToastItem {
  id: string
  message: string
  action?: { label: string; run: () => void }
}

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  shortcutsOpen: boolean
  toasts: ToastItem[]
  setTheme: (t: Theme) => void
  setSidebarCollapsed: (v: boolean) => void
  setShortcutsOpen: (v: boolean) => void
  toast: (message: string, action?: ToastItem['action']) => void
  dismissToast: (id: string) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      sidebarCollapsed: false,
      shortcutsOpen: false,
      toasts: [],
      setTheme: (theme) => set({ theme }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      toast: (message, action) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }))
        setTimeout(() => get().dismissToast(id), 4000)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'ws-ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
)
