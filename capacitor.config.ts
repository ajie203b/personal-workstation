import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.personal.workstation',
  appName: 'Kairos',
  webDir: 'dist',
  // 资源以 https://localhost 提供，IndexedDB 获得持久化安全上下文
  server: {
    androidScheme: 'https',
  },
  android: {
    // Android 15 edge-to-edge：自动给 WebView 加系统栏安全边距
    adjustMarginsForEdgeToEdge: 'auto',
    // 关掉 WebView 自己的缩放：整页放大会把侧栏/底栏一起放大，文档缩放由前端做
    zoomEnabled: false,
  },
}

export default config
