import { create } from 'zustand'
import { disposeUpdate, type AvailableUpdate } from '@/lib/appUpdateClient'

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

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  update: null,
  open: false,
  show: (update) => {
    // 重新检查拿到新句柄时，释放旧的（桌面版 Rust 侧资源）
    const prev = get().update
    if (prev && prev !== update) disposeUpdate(prev)
    set({ update, open: true })
  },
  setOpen: (open) => set({ open }),
}))
