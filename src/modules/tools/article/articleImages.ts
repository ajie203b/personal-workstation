import { LOCAL_PROXY, fetchBytes } from '@/lib/netFetch'
import { fileToDataUrl } from '@/lib/image'
import { isNative } from '@/lib/native'

/**
 * 图片本地化（v3.3 文章离线）：把正文里的外链图片下载下来转 dataURL，
 * 保证文档进库后离线可看。
 *
 * - 并发 4（微信图床限速温和，太多容易被掐）
 * - 画布缩到最长边 1600（复用 lib/image.ts 的 fileToDataUrl，同插入图片一套逻辑）
 * - 网页版直连跨域失败走本机代理（LOCAL_PROXY）；微信防盗链图在网页版依赖这条路径
 * - 拉不动的图保留原链接并在 title 上标注，不阻塞导出
 */

export interface ImageFailure {
  src: string
  reason: string
}

export interface LocalizeResult {
  /** 图片已替换为 dataURL（失败的保留原链接）的正文 HTML */
  html: string
  total: number
  ok: number
  failed: ImageFailure[]
}

/** 固定并发跑任务，结果按入参顺序回填 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, worker))
  return results
}

/** 魔数嗅探图片 MIME（fetchBytes 拿不到响应头，只能看字节） */
export function sniffImageMime(bytes: Uint8Array): string {
  const head = (len: number) => Array.from(bytes.subarray(0, len))
  if (head(8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png'
  if (head(3).join(',') === '255,216,255') return 'image/jpeg'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'GIF8') return 'image/gif'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  if (String.fromCharCode(...bytes.subarray(0, 2)) === 'BM') return 'image/bmp'
  // 嗅不出来按 JPEG 处理：保底仍是 image/*，能过 URL 白名单
  return 'image/jpeg'
}

/** 收集正文里需要下载的外链图（去重，data: 内嵌图不算） */
export function collectImageUrls(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const urls = new Set<string>()
  for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
    const src = (img.getAttribute('src') ?? '').trim()
    if (/^https?:\/\//i.test(src)) urls.add(src)
  }
  return [...urls]
}

/** 下载图片字节：直连失败且是网页版时走本机代理再试（原生无跨域限制，失败即失败） */
async function fetchImageBytes(url: string, referer?: string): Promise<ArrayBuffer> {
  const opts = {
    referer,
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    timeoutMs: 30_000,
  }
  try {
    return await fetchBytes(url, opts)
  } catch (e) {
    if (isNative()) throw e
    try {
      return await fetchBytes(LOCAL_PROXY + encodeURIComponent(url), { accept: opts.accept, timeoutMs: 30_000 })
    } catch {
      throw e
    }
  }
}

/** 字节 → dataURL；≤300KB 原样，大图画布缩到最长边 1600 */
async function bytesToDataUrl(bytes: ArrayBuffer, mime: string): Promise<string> {
  const file = new File([bytes], 'img', { type: mime })
  return fileToDataUrl(file, 1600)
}

/**
 * 正文图片本地化：外链图下载转 dataURL（并发 4），失败的保留原链接 + title 标注。
 * @param referer 抓图时带的来源页（微信图床看 Referer）
 */
export async function localizeImages(
  html: string,
  opts: { referer?: string; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<LocalizeResult> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imgs = Array.from(doc.querySelectorAll('img[src]'))
  const urls = collectImageUrls(html)
  const failed: ImageFailure[] = []
  let done = 0

  const byUrl = new Map<string, string>()
  await mapWithConcurrency(urls, opts.concurrency ?? 4, async (url) => {
    try {
      const bytes = await fetchImageBytes(url, opts.referer)
      const mime = sniffImageMime(new Uint8Array(bytes))
      byUrl.set(url, await bytesToDataUrl(bytes, mime))
    } catch (e) {
      failed.push({ src: url, reason: e instanceof Error ? e.message : '网络错误' })
    } finally {
      done++
      opts.onProgress?.(done, urls.length)
    }
  })

  for (const img of imgs) {
    const src = (img.getAttribute('src') ?? '').trim()
    const dataUrl = byUrl.get(src)
    if (dataUrl) {
      // srcset 里可能还挂着懒加载低清地址，本地化后一并丢掉
      img.setAttribute('src', dataUrl)
      img.removeAttribute('srcset')
    } else if (failed.some((f) => f.src === src)) {
      img.setAttribute('title', '图片未下载（离线后可能无法显示）')
    }
  }

  return {
    html: doc.body.innerHTML,
    total: urls.length,
    ok: byUrl.size,
    failed,
  }
}
