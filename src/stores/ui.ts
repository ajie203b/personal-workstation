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
/** 模型智能排名卡的位置（v2.2：默认落在新的「工具」页） */
export type IntelPlacement = 'tools' | 'today' | 'stats' | 'hidden'

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
  intelPlacement: IntelPlacement
  /** 一次性迁移标记：老版本把榜单默认放今日页，搬到工具页后不再重复搬 */
  toolsIntelMoved?: boolean
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
  setIntelPlacement: (p: IntelPlacement) => void
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
      intelPlacement: 'tools',
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
      setIntelPlacement: (intelPlacement) => set({ intelPlacement }),
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
      partialize: (s) => ({ theme: s.theme, themeMode: s.themeMode, accent: s.accent, density: s.density, motion: s.motion, sidebarCollapsed: s.sidebarCollapsed, haptics: s.haptics, intelPlacement: s.intelPlacement, toolsIntelMoved: s.toolsIntelMoved }),
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
          intelPlacement: resolveIntelPlacement(p),
          toolsIntelMoved: true,
        }
      },
    },
  ),
)

/**
 * 榜单位置：v2.2 起首页是「工具」页。
 * 老版本没手动改过的值都是 'today'（当时的默认），一次性搬到工具页；
 * 搬过之后用户在设置里选什么都原样尊重。
 */
function resolveIntelPlacement(p: Partial<UiState>): IntelPlacement {
  const valid = (['tools', 'today', 'stats', 'hidden'] as IntelPlacement[])
  const saved = valid.includes(p.intelPlacement as IntelPlacement) ? (p.intelPlacement as IntelPlacement) : null
  if (!saved) return 'tools'
  if (!p.toolsIntelMoved && saved === 'today') return 'tools'
  return saved
}

/** Ctrl/Cmd+K 快捷键不走 persist 的 setter，专供命令面板 */
export function togglePalette() {
  useUi.getState().setPaletteOpen(!useUi.getState().paletteOpen)
}
