import { isTauri } from './native'

/**
 * 跨域请求通道：Windows 桌面版（Tauri）走 Rust 侧 HTTP，不受浏览器 CORS 限制，
 * 也能带 User-Agent / Referer（Cargo 里开了 unsafe-headers）；其他环境就是普通 fetch。
 * 返回值是标准 Response，调用方不用区分。
 */
export async function corsFreeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isTauri()) return fetch(url, init)
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
  // Tauri 的 fetch 不认 cache / redirect 以外的浏览器专用字段，挑能用的传
  const { headers, method, body, signal } = init
  return tauriFetch(url, { headers, method, body, signal, connectTimeout: 15_000 })
}
