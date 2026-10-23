import { create } from 'zustand'
import type { AvailableUpdate } from '@/lib/appUpdateClient'

/**
 * 应用内更新弹窗的全局状态：启动静默检查和设置页「检查更新」共用同一个弹窗。
 * 只在安卓 App / 桌面版里会被写入；网页版永远是空的。
 */
interface AppUpdateState {
  update: AvailableUpdate | null
  open: boolean
  show: (update: AvailableUpdate) => void
  setOpen: (open: boolean) => void
}

export const useAppUpdate = create<AppUpdateState>((set) => ({
  update: null,
  open: false,
  show: (update) => set({ update, open: true }),
  setOpen: (open) => set({ open }),
}))
