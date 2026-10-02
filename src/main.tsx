import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from './App'
import './styles/index.css'
import { registerSW } from 'virtual:pwa-register'
import { initInstallPrompt } from './lib/pwa'
import { isNative, initAndroidBackButton } from './lib/native'
import { cleanupStaleStreaming } from './db/ai'
import { ErrorBoundary } from './shared/ErrorBoundary'

// PWA（Service Worker + 安装提示）仅在浏览器环境启用；
// 原生安卓壳内资源已内嵌 APK，无需 SW，改为接管系统返回键。
if (isNative()) {
  void initAndroidBackButton()
} else {
  registerSW({ immediate: true })
  initInstallPrompt()
}

// 上次会话中断遗留的 streaming/queued 消息标记为已停止（保留已生成内容）
void cleanupStaleStreaming()

// 阅读位置由应用自己的双坐标机制管理，禁用浏览器的刷新滚动恢复
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

const PageLoader = (
  <div className="h-full grid place-items-center text-on-surface-2 text-[13px]">
    <div className="flex flex-col items-center gap-2">
      <span className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      载入中…
    </div>
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <Suspense fallback={PageLoader}>
          <App />
        </Suspense>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
