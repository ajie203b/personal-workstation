import { defineConfig } from 'vitest/config'

// 单测只覆盖纯逻辑（日期 / 自然语言解析 / 重复任务推算），不加载 vite.config.ts 里的
// React、PWA、static-copy 插件——它们对 node 环境没有意义，还会拖慢启动。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
