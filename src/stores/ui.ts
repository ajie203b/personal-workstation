import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Tier } from '@/db/db'

export type Theme = 'light' | 'dark'
/** 主题档位：跟随系统 / 固定浅色 / 固定深色 */
export type ThemeMode = 'system' | 'light' | 'dark'
/** 强调色（macOS 系统设置同款 6 色） */
export type Accent = 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'green'
/** 界面密度（对应 macOS 字号档） */
export type Density = 'compact' | 'default' | 'large'

/** 阅读器两侧栏：宽度按设备记忆，折叠状态同文档无关 */
export interface ReaderPanels {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
}

export const READER_PANEL_LIMITS = {
  left: { min: 200, max: 420 },
  right: { min: 260, max: 480 },
} as const

export const DEFAULT_READER_PANELS: ReaderPanels = {
  leftWidth: 264,
  rightWidth: 328,
  leftCollapsed: false,
  rightCollapsed: false,
}

export interface ToastItem {
  id: string
  message: string
  leaving?: boolean
  action?: { label: string; run: () => void }
}

interface UiState {
  theme: Theme
  themeMode: ThemeMode
  accent: Accent
  density: Density
  /** 应用内动效总开关（独立于系统 prefers-reduced-motion） */
  motion: boolean
  sidebarCollapsed: boolean
  /** 触觉/振动反馈（勾选、拖拽、长按确认等）。默认开，设置页可关。 */
  haptics: boolean
  readerPanels: ReaderPanels
  shortcutsOpen: boolean
  paletteOpen: boolean
  toasts: ToastItem[]
  /** 全局「添加任务」抽屉（手机悬浮按钮 / 快捷键 / 深链都走这里） */
  addSheet: { open: boolean; tier: Tier; todayContext: boolean }
  setTheme: (t: Theme) => void
  setThemeMode: (m: ThemeMode) => void
  setAccent: (a: Accent) => void
  setDensity: (d: Density) => void
  setMotion: (v: boolean) => void
  setSidebarCollapsed: (v: boolean) => void
  setHaptics: (v: boolean) => void
  setReaderPanels: (patch: Partial<ReaderPanels>) => void
  setShortcutsOpen: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
  openAddSheet: (opts?: { tier?: Tier; todayContext?: boolean }) => void
  closeAddSheet: () => void
  toast: (message: string, action?: ToastItem['action']) => void
  dismissToast: (id: string) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      themeMode: 'light',
      accent: 'blue',
      density: 'default',
      motion: true,
      sidebarCollapsed: false,
      haptics: true,
      readerPanels: DEFAULT_READER_PANELS,
      shortcutsOpen: false,
      paletteOpen: false,
      addSheet: { open: false, tier: 'anytime', todayContext: false },
      toasts: [],
      setTheme: (theme) => set({ theme, themeMode: theme }),
      setThemeMode: (themeMode) => set({ themeMode }),
      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      setMotion: (motion) => set({ motion }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setHaptics: (haptics) => set({ haptics }),
      setReaderPanels: (patch) => set((s) => ({ readerPanels: normalizeReaderPanels({ ...s.readerPanels, ...patch }) })),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      openAddSheet: (opts) => set({ addSheet: { open: true, tier: opts?.tier ?? 'anytime', todayContext: opts?.todayContext ?? false } }),
      closeAddSheet: () => set((s) => ({ addSheet: { ...s.addSheet, open: false } })),
      toast: (message, action) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }))
        setTimeout(() => get().dismissToast(id), 4000)
      },
      dismissToast: (id) => { set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })); setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 160) },
    }),
    {
      name: 'ws-ui',
      partialize: (s) => ({ theme: s.theme, themeMode: s.themeMode, accent: s.accent, density: s.density, motion: s.motion, sidebarCollapsed: s.sidebarCollapsed, haptics: s.haptics, readerPanels: s.readerPanels }),
      // 旧版本 theme 曾允许 'system'，现在收敛进 themeMode 并保留合法值
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState> & { theme?: string }
        const mode = (['system', 'light', 'dark'] as ThemeMode[]).includes(p.themeMode as ThemeMode)
          ? (p.themeMode as ThemeMode)
          : p.theme === 'dark' ? 'dark' : 'light'
        return {
          ...current,
          ...p,
          themeMode: mode,
          theme: mode === 'system' ? current.theme : mode,
          accent: p.accent ?? 'blue',
          density: p.density ?? 'default',
          motion: p.motion !== false,
          haptics: p.haptics !== false,
          readerPanels: normalizeReaderPanels(p.readerPanels),
        }
      },
    },
  ),
)

/** 旧存档 / 手改 localStorage 都可能带脏值，读入时夹到合法区间 */
function normalizeReaderPanels(input: unknown): ReaderPanels {
  const p = (input ?? {}) as Partial<ReaderPanels>
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
  return {
    leftWidth: num(p.leftWidth, DEFAULT_READER_PANELS.leftWidth, READER_PANEL_LIMITS.left.min, READER_PANEL_LIMITS.left.max),
    rightWidth: num(p.rightWidth, DEFAULT_READER_PANELS.rightWidth, READER_PANEL_LIMITS.right.min, READER_PANEL_LIMITS.right.max),
    leftCollapsed: p.leftCollapsed === true,
    rightCollapsed: p.rightCollapsed === true,
  }
}

/** Ctrl/Cmd+K 快捷键不走 persist 的 setter，专供命令面板 */
export function togglePalette() {
  useUi.getState().setPaletteOpen(!useUi.getState().paletteOpen)
}
