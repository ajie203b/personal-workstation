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
    if (canGoBack) {
      window.history.back()
    } else {
      void App.exitApp()
    }
  })
}
