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
  /**
   * 期望的 SHA-256（小写十六进制）。给了就：
   * - 下载后、写缓存前校验，不符不写缓存、换下一个镜像（防镜像 / 代理以 HTTP 200 返回错误页）
   * - 读缓存时核对「已校验」标记与长度；没有标记（旧版本写的缓存）就当场算一遍，不符删掉重下
   */
  sha256?: string
}

const VERIFIED_HEADER = 'x-model-sha256'
const LENGTH_HEADER = 'x-model-length'

/** Web Crypto 算 SHA-256（87MB 的编码器一次性 digest，内存里本来就有这份字节） */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function verifiedResponse(buf: ArrayBuffer, sha256?: string): Response {
  const headers: Record<string, string> = { 'content-length': String(buf.byteLength) }
  if (sha256) {
    headers[VERIFIED_HEADER] = sha256
    headers[LENGTH_HEADER] = String(buf.byteLength)
  }
  return new Response(buf, { headers })
}

/** 读缓存命中的一份：校验通过返回字节，不通过返回 null（调用方删掉重下） */
async function readVerified(c: Cache, key: Request, hit: Response, sha256?: string): Promise<ArrayBuffer | null> {
  const marked = hit.headers.get(VERIFIED_HEADER)
  const markedLen = Number(hit.headers.get(LENGTH_HEADER))
  const buf = await hit.arrayBuffer()
  if (!sha256) return buf
  if (marked === sha256 && markedLen === buf.byteLength) return buf
  // 标记缺失或不符（旧版本写的、写入被截断）：当场算一遍
  if ((await sha256Hex(buf)) !== sha256) return null
  // 校验通过：补写标记，下次不用再算
  try {
    await c.put(key, verifiedResponse(buf, sha256))
  } catch { /* 补标记失败不影响这次使用 */ }
  return buf
}

/**
 * App 根地址：主线程用 document.baseURI；Worker 里没有 document，
 * 构建后 Worker 脚本在 <根>/assets/ 下，往上一级就是根。
 * 用来解析清单里的相对路径（App 自带的小模型文件，如 models/ppocr_keys_v1.txt）。
 */
function appBase(): string {
  if (typeof document !== 'undefined') return document.baseURI
  return new URL('../', self.location.href).href
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
  const key = keyUrl(spec.id, spec.version)
  const hit = await c.match(key)
  if (hit) {
    const buf = await readVerified(c, key, hit, spec.sha256)
    if (buf) return buf
    await c.delete(key)
  }

  let lastError = '所有镜像都下载失败'
  for (const raw of spec.urls) {
    let url = raw
    let host = raw
    try {
      const u = new URL(raw, appBase())
      url = u.href
      host = u.host
    } catch {
      // 保持原样交给 fetch
    }
    try {
      // 连接卡住（国内连不上的境外源常见）20 秒就换下一个镜像；开始收数据后不再限时
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20000)
      let res: Response
      try {
        // 带校验值的大模型自己存 Cache Storage，不再经 HTTP 缓存：否则镜像回过一次错误内容，
        // 换回同一来源重试时浏览器还会把那份坏响应原样再给一遍
        res = await fetch(url, { cache: spec.sha256 ? 'no-store' : 'force-cache', signal: ctrl.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        lastError = `${host} HTTP ${res.status}`
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
        if (!(await acceptDownload(buf.buffer, spec.sha256))) {
          lastError = `${host} 返回的文件校验不符（可能是错误页或被截断）`
          continue
        }
        await c.put(key, verifiedResponse(buf.buffer, spec.sha256))
        return buf.buffer
      }
      const buf = await res.arrayBuffer()
      if (!(await acceptDownload(buf, spec.sha256))) {
        lastError = `${host} 返回的文件校验不符（可能是错误页或被截断）`
        continue
      }
      await c.put(key, verifiedResponse(buf, spec.sha256))
      spec.onProgress?.(1)
      return buf
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? '连接超时' : e.message) : '下载失败'
      lastError = `${host} ${msg}`
    }
  }
  throw new Error(`模型 ${spec.id} 下载失败：${lastError}`)
}

async function acceptDownload(buf: ArrayBuffer, sha256?: string): Promise<boolean> {
  return !sha256 || (await sha256Hex(buf)) === sha256
}

/** 删掉某个模型文件的缓存（加载 / 建会话失败、用户点「重试 / 换源」时用） */
export async function deleteModel(id: string, version: string): Promise<void> {
  if (typeof caches === 'undefined') return
  const c = await cache()
  await c.delete(keyUrl(id, version))
}

/**
 * 只清坏的：缓存条目的「已校验」标记（sha256 + 长度）与期望一致且与实际字节数相符就保留，
 * 否则（缺失标记、标记不符、长度对不上、读不出来）删掉，下次 getModel 重新下载。
 * 不重算哈希（87MB 的编码器算一遍要好几秒）；标记被伪造的情况由调用方在建会话失败时 deleteModel 兜底。
 * 返回 true = 保留（已校验），false = 不存在或已删除。
 */
export async function pruneModel(id: string, version: string, sha256: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  const c = await cache()
  const key = keyUrl(id, version)
  let ok = false
  try {
    const hit = await c.match(key)
    if (!hit) return false
    const marked = hit.headers.get(VERIFIED_HEADER)
    const markedLen = Number(hit.headers.get(LENGTH_HEADER))
    if (marked === sha256 && Number.isFinite(markedLen) && markedLen > 0) {
      const len = (await hit.arrayBuffer()).byteLength
      ok = len === markedLen
    }
  } catch {
    ok = false
  }
  if (!ok) await c.delete(key).catch(() => undefined)
  return ok
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
