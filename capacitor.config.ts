import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.personal.workstation',
  appName: '个人工作站',
  webDir: 'dist',
  // 资源以 https://localhost 提供，IndexedDB 获得持久化安全上下文
  server: {
    androidScheme: 'https',
  },
  android: {
    // Android 15 edge-to-edge：自动给 WebView 加系统栏安全边距
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
