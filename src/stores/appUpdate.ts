import { create } from 'zustand'
import { disposeUpdate, type AvailableUpdate } from '@/lib/appUpdateClient'

/**
 * 应用内更新弹窗的全局状态：启动静默检查和设置页「检查更新」共用同一个弹窗。
 * 只在安卓 App / 桌面版里会被写入；网页版永远是空的。
 */
interface AppUpdateState {
  update: AvailableUpdate | null
  open: boolean
  busy: boolean
  show: (update: AvailableUpdate) => void
  setOpen: (open: boolean) => void
  setBusy: (busy: boolean) => void
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  update: null,
  open: false,
  busy: false,
  show: (update) => {
    const prev = get().update
    if (prev === update || (prev?.tauriUpdate && prev.tauriUpdate === update.tauriUpdate)) {
      set({ open: true })
      return
    }
    // 晚到的检查结果不能释放正在下载安装的句柄。
    if (get().busy) { disposeUpdate(update); return }
    if (prev && prev !== update) disposeUpdate(prev)
    set({ update, open: true })
  },
  setOpen: (open) => { if (open || !get().busy) set({ open }) },
  setBusy: (busy) => set({ busy }),
}))
