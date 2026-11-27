import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import App from './App'
import './styles/index.css'
import { registerSW } from 'virtual:pwa-register'
import { initInstallPrompt } from './lib/pwa'
import { isNative, isTauri, initAndroidBackButton } from './lib/native'
import { ErrorBoundary } from './shared/ErrorBoundary'
import { useUi } from './stores/ui'

// PWA（Service Worker + 安装提示）仅在浏览器环境启用；
// 原生安卓壳内资源已内嵌 APK，无需 SW，改为接管系统返回键。
if (isNative()) {
  void initAndroidBackButton()
} else if (isTauri()) {
  // 桌面版：资源已打进安装包，不需要 Service Worker，也没有「安装应用」
} else {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useUi.getState().toast('发现网页新版本，点击刷新即可启用', {
        label: '刷新',
        run: () => void updateSW(true),
      })
    },
  })
  initInstallPrompt()
  // 线上部署新版本后旧标签页按需加载失效分包时自动刷新一次恢复，避免 ChunkLoadError 白屏
  window.addEventListener('vite:preloadError', () => {
    const key = 'kairos.chunkReloadAt'
    const last = Number(sessionStorage.getItem(key) || '0')
    if (Date.now() - last > 15_000) {
      sessionStorage.setItem(key, String(Date.now()))
      window.location.reload()
    }
  })
}

// 申请持久化存储（防止浏览器磁盘压力下驱逐 IndexedDB）
void navigator.storage?.persist?.()

// 阅读位置由应用自己的双坐标机制管理，禁用浏览器的刷新滚动恢复
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

const PageLoader = (
  <div className="h-full grid place-items-center text-on-surface-2 text-[13px]">
    <div role="status" className="flex flex-col items-center gap-2">
      <span aria-hidden className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      载入中…
    </div>
  </div>
)

const router = createHashRouter([{
  path: '*',
  element: <Suspense fallback={PageLoader}><App /></Suspense>,
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
