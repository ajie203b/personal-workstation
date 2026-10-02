import { create } from 'zustand'

interface TasksUiState {
  /** 键盘流当前聚焦的任务 */
  focusId: string | null
  setFocusId: (id: string | null) => void
  /** 详情面板打开的任务 */
  detailId: string | null
  openDetail: (id: string | null) => void
}

export const useTasksUi = create<TasksUiState>((set) => ({
  focusId: null,
  setFocusId: (focusId) => set({ focusId }),
  detailId: null,
  openDetail: (detailId) => set({ detailId }),
}))
