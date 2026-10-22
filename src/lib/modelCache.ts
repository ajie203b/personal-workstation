/**
 * 模型缓存（v3.3）：OCR / 证件照共用。
 *
 * - 首次使用才下载，存 Cache Storage（模型是可再生资源，**不进备份/同步/导出**——
 *   它压根不在 Dexie 里）；记录版本号，换版本自动重下。
 * - 镜像按顺序回退：自托管 → jsDelivr → npmmirror（国内 jsDelivr 不稳）。
 * - 进度用 Response.body 的流式读数；不支持流的老 WebView 退化成无进度一次下完。
 */

const CACHE_NAME = 'model-cache-v1'

export interface ModelSpec {
  /** 模型标识，如 'ppocr-det' */
  id: string
  /** 版本号，变了就重下 */
  version: string
  /** 镜像列表，按顺序回退 */
  urls: string[]
  /** 下载进度回调（0~1；无法计量时给 -1） */
  onProgress?: (ratio: number) => void
}

function keyUrl(id: string, version: string): Request {
  return new Request(`https://model-cache.local/${encodeURIComponent(id)}@${encodeURIComponent(version)}`)
}

async function cache(): Promise<Cache> {
  return caches.open(CACHE_NAME)
}

/** 取模型字节；没有缓存就按镜像顺序下载 */
export async function getModel(spec: ModelSpec): Promise<ArrayBuffer> {
  const c = await cache()
  const hit = await c.match(keyUrl(spec.id, spec.version))
  if (hit) return hit.arrayBuffer()

  let lastError = '所有镜像都下载失败'
  for (const url of spec.urls) {
    try {
      const res = await fetch(url, { cache: 'force-cache' })
      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        continue
      }
      const body = res.body
      if (spec.onProgress && body?.getReader) {
        const reader = body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        const total = Number(res.headers.get('content-length')) || 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            received += value.length
            spec.onProgress(total ? received / total : -1)
          }
        }
        const buf = new Uint8Array(received)
        let at = 0
        for (const ch of chunks) {
          buf.set(ch, at)
          at += ch.length
        }
        await c.put(keyUrl(spec.id, spec.version), new Response(buf.buffer, { headers: { 'content-length': String(received) } }))
        return buf.buffer
      }
      const buf = await res.arrayBuffer()
      await c.put(keyUrl(spec.id, spec.version), new Response(buf))
      spec.onProgress?.(1)
      return buf
    } catch (e) {
      lastError = e instanceof Error ? e.message : '下载失败'
    }
  }
  throw new Error(`模型 ${spec.id} 下载失败：${lastError}`)
}

/** 清掉全部模型缓存，返回释放的字节数 */
export async function clearModelCache(): Promise<number> {
  const freed = await modelCacheBytes()
  await caches.delete(CACHE_NAME)
  return freed
}

/** 当前模型缓存占用（字节） */
export async function modelCacheBytes(): Promise<number> {
  if (!(await caches.has(CACHE_NAME))) return 0
  const c = await cache()
  const keys = await c.keys()
  let total = 0
  for (const req of keys) {
    const res = await c.match(req)
    if (res) total += (await res.clone().arrayBuffer()).byteLength
  }
  return total
}
