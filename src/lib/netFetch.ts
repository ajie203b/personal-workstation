import { BROWSER_UA, LOCAL_PROXY, httpBytes, httpText } from './http'

export { BROWSER_UA, LOCAL_PROXY }

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
  return httpText(url, {
    headers: headersOf(opts),
    timeoutMs: opts.timeoutMs ?? 20_000,
    proxyFallback: opts.proxyFallback,
  })
}

/** 抓二进制（图片、模型、媒体）。 */
export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<ArrayBuffer> {
  const { bytes } = await httpBytes(url, {
    headers: headersOf(opts),
    timeoutMs: opts.timeoutMs ?? 60_000,
  })
  return bytes
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
  const { bytes, finalUrl, contentType } = await httpBytes(url, {
    headers: headersOf(opts),
    timeoutMs: opts.timeoutMs ?? 20_000,
    proxyFallback: opts.proxyFallback,
  })
  // meta charset 只可能在前几 KB，用 latin1 扫（ASCII 兼容，不会截断多字节）
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes).subarray(0, 2048))
  return {
    body: decodeBytes(bytes, contentType, head),
    finalUrl,
    contentType,
  }
}
