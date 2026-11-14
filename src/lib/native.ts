import { Capacitor } from '@capacitor/core'
import { guardNavigation } from './unsavedGuard'

/** 是否运行在原生壳（安卓 App）内 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** 是否运行在 Tauri 桌面壳内（Windows 桌面版） */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 是否 Tauri 主窗口：资源管理器开出的独立文档窗口不跑同步、深链等全局副作用 */
export function isMainWindow(): boolean {
  if (!isTauri()) return true
  const label = (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label
  return !label || label === 'main'
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
    guardNavigation(() => {
      if (canGoBack) {
        window.history.back()
      } else {
        void App.exitApp()
      }
    })
  })
}
