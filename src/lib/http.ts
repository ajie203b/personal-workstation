import { CapacitorHttp } from '@capacitor/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isNative, isTauri } from './native'

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 网页版跨域兜底：本机小代理（GET http://127.0.0.1:8787/?url=<encodeURIComponent>） */
export const LOCAL_PROXY = 'http://127.0.0.1:8787/?url='

export interface HttpOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  connectTimeoutMs?: number
  cache?: RequestCache
  /** 网页版直连失败后走 LOCAL_PROXY 再试一次（默认关） */
  proxyFallback?: boolean
  /** 状态码前置检查（返回异常前先触发，例如 429 映射） */
  onStatus?: (status: number) => void
}

export interface HttpTextResult {
  body: string
  finalUrl: string
  contentType: string
}

export interface HttpBytesResult {
  bytes: ArrayBuffer
  finalUrl: string
  contentType: string
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function headerValue(headers: Record<string, string> | undefined, target: string): string {
  if (!headers) return ''
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === target.toLowerCase())
  return hit ? headers[hit] : ''
}

function assertStatus(status: number, ok: boolean, onStatus?: (status: number) => void): void {
  onStatus?.(status)
  if (!ok) throw new Error(`HTTP ${status}`)
}

async function webFetchResponse(url: string, opts: HttpOptions, timeoutMs: number, connectTimeoutMs: number): Promise<Response> {
  if (!isTauri()) {
    const res = await fetch(url, {
      headers: opts.headers,
      cache: opts.cache ?? 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    assertStatus(res.status, res.ok, opts.onStatus)
    return res
  }

  const ctrl = new AbortController()
  const timer = globalThis.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await tauriFetch(url, {
      headers: opts.headers,
      signal: ctrl.signal,
      connectTimeout: connectTimeoutMs,
    })
    assertStatus(res.status, res.ok, opts.onStatus)
    return res
  } finally {
    globalThis.clearTimeout(timer)
  }
}

async function withProxyFallback<T>(url: string, opts: HttpOptions, run: (target: string) => Promise<T>): Promise<T> {
  try {
    return await run(url)
  } catch (e) {
    if (opts.proxyFallback && !isNative() && !isTauri()) {
      try {
        return await run(LOCAL_PROXY + encodeURIComponent(url))
      } catch {
        throw e
      }
    }
    throw e
  }
}

export async function httpText(url: string, opts: HttpOptions = {}): Promise<HttpTextResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const connectTimeoutMs = opts.connectTimeoutMs ?? Math.min(timeoutMs, 15_000)
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers: opts.headers,
      responseType: 'text',
      connectTimeout: connectTimeoutMs,
      readTimeout: timeoutMs,
    })
    assertStatus(res.status, res.status < 400, opts.onStatus)
    return {
      body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''),
      finalUrl: res.url || url,
      contentType: headerValue(res.headers, 'content-type'),
    }
  }
  return withProxyFallback(url, opts, async (target) => {
    const res = await webFetchResponse(target, opts, timeoutMs, connectTimeoutMs)
    return {
      body: await res.text(),
      finalUrl: target === url ? res.url || url : url,
      contentType: res.headers.get('content-type') ?? '',
    }
  })
}

export async function httpBytes(url: string, opts: HttpOptions = {}): Promise<HttpBytesResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const connectTimeoutMs = opts.connectTimeoutMs ?? Math.min(timeoutMs, 15_000)
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers: opts.headers,
      responseType: 'arraybuffer',
      connectTimeout: connectTimeoutMs,
      readTimeout: timeoutMs,
    })
    assertStatus(res.status, res.status < 400, opts.onStatus)
    const raw = res.data as string | ArrayBuffer
    const bytes = typeof raw === 'string' ? (base64ToBytes(raw).buffer as ArrayBuffer) : raw
    return {
      bytes,
      finalUrl: res.url || url,
      contentType: headerValue(res.headers, 'content-type'),
    }
  }
  return withProxyFallback(url, opts, async (target) => {
    const res = await webFetchResponse(target, opts, timeoutMs, connectTimeoutMs)
    return {
      bytes: await res.arrayBuffer(),
      finalUrl: target === url ? res.url || url : url,
      contentType: res.headers.get('content-type') ?? '',
    }
  })
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const { body } = await httpText(url, opts)
  if (!body.trim()) throw new Error('空响应')
  return JSON.parse(body) as T
}
