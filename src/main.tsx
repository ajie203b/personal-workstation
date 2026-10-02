import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from './App'
import './styles/index.css'
import { registerSW } from 'virtual:pwa-register'
import { initInstallPrompt } from './lib/pwa'
import { isNative, initAndroidBackButton } from './lib/native'

// PWA（Service Worker + 安装提示）仅在浏览器环境启用；
// 原生安卓壳内资源已内嵌 APK，无需 SW，改为接管系统返回键。
if (isNative()) {
  void initAndroidBackButton()
} else {
  registerSW({ immediate: true })
  initInstallPrompt()
}

// 阅读位置由应用自己的双坐标机制管理，禁用浏览器的刷新滚动恢复
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
