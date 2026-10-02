/// <reference types="vite-plugin-pwa/client" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { VitePWA } from 'vite-plugin-pwa'

// npm run dev:lan / preview:lan 时以 HTTPS + 局域网可访问方式启动，
// 供安卓手机/平板通过 https://<电脑IP>:端口 安装 PWA（Service Worker 需要安全上下文）。
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan'
  return {
    base: './',
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    plugins: [
      react(),
      tailwindcss(),
      // PDF.js 中日韩字符映射与标准字体（CJK 文档文本提取/渲染必需）
      viteStaticCopy({
        targets: [
          { src: 'node_modules/pdfjs-dist/cmaps', dest: 'pdfjs' },
          { src: 'node_modules/pdfjs-dist/standard_fonts', dest: 'pdfjs' },
        ],
      }),
      ...(lan ? [basicSsl()] : []),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: '个人工作站',
          short_name: '工作站',
          description: '任务清单 × 文档工作站 × AI 助手面板的一体化个人工作台',
          lang: 'zh-CN',
          dir: 'ltr',
          start_url: './',
          scope: './',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#0B57D0',
          background_color: '#F5F5F7',
          icons: [
            { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: './icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: lan ? { host: true } : {},
    preview: lan ? { host: true } : { host: true },
  }
})
