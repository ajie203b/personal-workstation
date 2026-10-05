import { Capacitor } from '@capacitor/core'

/** 是否运行在原生壳（安卓 App）内 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * 安卓返回键：非首页时后退一步，首页时退出应用。
 * 必须在原生壳内调用（@capacitor/app 的监听会接管系统返回键默认行为）。
 */
export async function initAndroidBackButton(): Promise<void> {
  if (!isNative()) return
  const { App } = await import('@capacitor/app')
  await App.addListener('backButton', ({ canGoBack }) => {
    // 先检查是否有打开的弹层（Radix Dialog/Sheet 等）
    const openDialog = document.querySelector('[role=dialog]')
    if (openDialog) {
      // 关闭最上层弹层
      const closeBtn = openDialog.querySelector("button[aria-label=\"关闭\"]") as HTMLElement | null
      if (closeBtn) { closeBtn.click(); return }
      // Radix 处理 Esc
      openDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (canGoBack) {
      window.history.back()
    } else {
      void App.exitApp()
    }
  })
}
