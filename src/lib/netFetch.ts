import { CapacitorHttp } from '@capacitor/core'
import { isNative } from './native'

/**
 * 工具矩阵的公共抓取通道（v3.3）。
 *
 * - 原生壳走 CapacitorHttp：不受跨域限制、可带浏览器 UA（文章抓取 / 图片下载都靠它）
 * - 网页版走 fetch；跨域失败时可选走本机代理（LOCAL_PROXY，fanqieFqweb 同款）
 *
 * fanqieFqweb.ts 里还留着自己的一份（跑在既有测试上，先不动）；新代码统一用这里。
 */

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 网页版跨域兜底：本机小代理（GET http://127.0.0.1:8787/?url=<encodeURIComponent>） */
export const LOCAL_PROXY = 'http://127.0.0.1:8787/?url='

export interface FetchOptions {
  accept?: string
  referer?: string
  ua?: string
  timeoutMs?: number
  /** 网页版直连失败后走 LOCAL_PROXY 再试一次（默认关；抓正文时打开） */
  proxyFallback?: boolean
}

export interface FetchTextResult {
  body: string
  finalUrl: string
  contentType: string
  charset?: string
}

function headersOf(opts: FetchOptions): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': opts.ua ?? BROWSER_UA,
    Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (opts.referer) h.Referer = opts.referer
  return h
}

/** 抓文本/HTML。finalUrl 是跟随重定向后的地址（短链解析用） */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchTextResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  try {
    if (isNative()) {
      const res = await CapacitorHttp.get({
        url,
        headers: headersOf(opts),
        responseType: 'text',
        connectTimeout: 15_000,
        readTimeout: timeoutMs,
      })
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return {
        body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''),
        finalUrl: res.url || url,
        contentType: res.headers?.['content-type'] ?? res.headers?.['Content-Type'] ?? '',
      }
    }
    return await webFetchText(url, opts, timeoutMs)
  } catch (e) {
    if (opts.proxyFallback && !isNative()) {
      try {
        return await webFetchText(LOCAL_PROXY + encodeURIComponent(url), opts, timeoutMs)
      } catch {
        throw e
      }
    }
    throw e
  }
}

async function webFetchText(url: string, opts: FetchOptions, timeoutMs: number): Promise<FetchTextResult> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: headersOf(opts),
      cache: 'no-store',
      signal: ctrl.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return {
      body: await res.text(),
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
    }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 抓二进制（图片、模型、媒体）。
 * 原生 CapacitorHttp 的 arraybuffer 返回 base64 字符串，这里统一转成 ArrayBuffer。
 */
export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<ArrayBuffer> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers: headersOf(opts),
      responseType: 'arraybuffer',
      connectTimeout: 15_000,
      readTimeout: timeoutMs,
    })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    const data = res.data as string | ArrayBuffer
    if (typeof data !== 'string') return data
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }
  const res = await fetch(url, { headers: headersOf(opts), signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.arrayBuffer()
}

/**
 * 按「响应头 charset → <meta charset>」猜编码，把字节解成文本（老站 GBK 也能解）。
 */
export function decodeBytes(bytes: ArrayBuffer, contentType: string, htmlHint?: string): string {
  const headerCharset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase()
  const metaCharset =
    htmlHint != null ? (/<meta[^>]+charset=["']?([\w-]+)/i.exec(htmlHint)?.[1]?.toLowerCase() ?? undefined) : undefined
  // UTF-8 兜底；TextDecoder 对非法名会抛，逐个降级
  for (const name of [headerCharset, metaCharset, 'utf-8']) {
    if (!name) continue
    try {
      return new TextDecoder(name).decode(bytes)
    } catch {
      continue
    }
  }
  return new TextDecoder().decode(bytes)
}

/**
 * 猜编码抓文本（网页转文档用）：拿原始字节，
 * 按「响应头 charset → <meta charset> → UTF-8」解码，GBK 老站不会乱码。
 */
export async function fetchTextSmart(url: string, opts: FetchOptions = {}): Promise<FetchTextResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const run = async (): Promise<FetchTextResult> => {
    if (isNative()) {
      const res = await CapacitorHttp.get({
        url,
        headers: headersOf(opts),
        responseType: 'arraybuffer',
        connectTimeout: 15_000,
        readTimeout: timeoutMs,
      })
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      const raw = res.data as string | ArrayBuffer
      const bytes = typeof raw === 'string' ? base64ToBytes(raw) : new Uint8Array(raw)
      const contentType = res.headers?.['content-type'] ?? res.headers?.['Content-Type'] ?? ''
      return finish(bytes, contentType, res.url || url)
    }
    const res = await fetch(url, {
      headers: headersOf(opts),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return finish(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') ?? '', res.url || url)
  }
  try {
    return await run()
  } catch (e) {
    if (opts.proxyFallback && !isNative()) {
      try {
        return await (async () => {
          const res = await fetch(LOCAL_PROXY + encodeURIComponent(url), {
            headers: headersOf(opts),
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return finish(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') ?? '', url)
        })()
      } catch {
        throw e
      }
    }
    throw e
  }
}

function finish(bytes: Uint8Array, contentType: string, finalUrl: string): FetchTextResult {
  // meta charset 只可能在前几 KB，用 latin1 扫（ASCII 兼容，不会截断多字节）
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
  return {
    body: decodeBytes(bytes.buffer, contentType, head),
    finalUrl,
    contentType,
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
