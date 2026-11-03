import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCacheStorage } from './fakeCacheStorage'
import { deleteModel, getModel, pruneModel, sha256Hex } from './modelCache'

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
const text = (b: ArrayBuffer) => new TextDecoder().decode(b)

const GOOD = enc('真正的模型字节 encoder-weights')
const KEY = 'https://model-cache.local/m%2Fencoder.onnx@rev1'

let storage: FakeCacheStorage
let fetchMock: ReturnType<typeof vi.fn>

/** 按 URL 返回响应体；镜像「以 200 返回错误页」就是 bad 那一项 */
function serve(routes: Record<string, string | ArrayBuffer>) {
  fetchMock.mockImplementation(async (url: string) => {
    const body = routes[url]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(typeof body === 'string' ? enc(body) : body.slice(0), { status: 200 })
  })
}

beforeEach(() => {
  storage = new FakeCacheStorage()
  fetchMock = vi.fn()
  vi.stubGlobal('caches', storage)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function cached(): Promise<string | undefined> {
  const c = await storage.open('model-cache-v1')
  const hit = await c.match(KEY)
  return hit ? text(await hit.arrayBuffer()) : undefined
}

describe('modelCache SHA-256 校验', () => {
  it('镜像以 HTTP 200 返回错误内容：不写缓存，换下一个源成功', async () => {
    const sha = await sha256Hex(GOOD)
    serve({ 'https://bad.mirror/encoder.onnx': '<html>请登录后下载</html>', 'https://good.mirror/encoder.onnx': GOOD })

    const buf = await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://bad.mirror/encoder.onnx', 'https://good.mirror/encoder.onnx'], sha256: sha })

    expect(text(buf)).toBe(text(GOOD))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await cached()).toBe(text(GOOD))
    // 带校验值的下载不经 HTTP 缓存，免得重试时浏览器把坏响应再给一遍
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('流式下载（有进度回调）同样校验，坏内容不进缓存', async () => {
    const sha = await sha256Hex(GOOD)
    serve({ 'https://bad.mirror/encoder.onnx': 'truncated', 'https://good.mirror/encoder.onnx': GOOD })
    const progress: number[] = []
    const buf = await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://bad.mirror/encoder.onnx', 'https://good.mirror/encoder.onnx'], sha256: sha, onProgress: (r) => progress.push(r) })
    expect(text(buf)).toBe(text(GOOD))
    expect(await cached()).toBe(text(GOOD))
  })

  it('所有源都回错误内容：报校验不符，缓存保持为空', async () => {
    const sha = await sha256Hex(GOOD)
    serve({ 'https://bad.mirror/encoder.onnx': 'oops', 'https://bad2.mirror/encoder.onnx': 'oops2' })
    await expect(
      getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://bad.mirror/encoder.onnx', 'https://bad2.mirror/encoder.onnx'], sha256: sha }),
    ).rejects.toThrow(/校验不符/)
    expect(await cached()).toBeUndefined()
  })

  it('预置的坏缓存（旧版本写进去、没有校验标记）：读时发现不符，删掉重下', async () => {
    const sha = await sha256Hex(GOOD)
    const c = await storage.open('model-cache-v1')
    await c.put(KEY, new Response(enc('<html>旧版缓存进来的错误页</html>')))
    serve({ 'https://good.mirror/encoder.onnx': GOOD })

    const buf = await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://good.mirror/encoder.onnx'], sha256: sha })

    expect(text(buf)).toBe(text(GOOD))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await cached()).toBe(text(GOOD))
  })

  it('无标记但内容正确的旧缓存：校验一次通过并补写标记，不重新下载', async () => {
    const sha = await sha256Hex(GOOD)
    const c = await storage.open('model-cache-v1')
    await c.put(KEY, new Response(GOOD.slice(0)))
    const buf = await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://good.mirror/encoder.onnx'], sha256: sha })
    expect(text(buf)).toBe(text(GOOD))
    expect(fetchMock).not.toHaveBeenCalled()
    const hit = await c.match(KEY)
    expect(hit?.headers.get('x-model-sha256')).toBe(sha)
  })

  it('deleteModel 只删指定条目', async () => {
    const sha = await sha256Hex(GOOD)
    serve({ 'https://good.mirror/encoder.onnx': GOOD })
    await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://good.mirror/encoder.onnx'], sha256: sha })
    await deleteModel('m/encoder.onnx', 'rev1')
    expect(await cached()).toBeUndefined()
  })

  it('不给 sha256 的旧调用方（OCR / 证件照）行为不变', async () => {
    serve({ 'https://good.mirror/encoder.onnx': 'anything' })
    const buf = await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://good.mirror/encoder.onnx'] })
    expect(text(buf)).toBe('anything')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'force-cache' })
  })
})

describe('pruneModel：只清未通过校验的缓存', () => {
  const OTHER_KEY = 'https://model-cache.local/m%2Fdecoder.onnx@rev1'

  it('已校验条目保留，不重下；未缓存的返回 false', async () => {
    const sha = await sha256Hex(GOOD)
    serve({ 'https://good.mirror/encoder.onnx': GOOD })
    await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://good.mirror/encoder.onnx'], sha256: sha })
    expect(await pruneModel('m/encoder.onnx', 'rev1', sha)).toBe(true)
    expect(await cached()).toBe(text(GOOD))
    expect(await pruneModel('m/decoder.onnx', 'rev1', sha)).toBe(false)
    // 再取一次直接命中缓存
    fetchMock.mockClear()
    await getModel({ id: 'm/encoder.onnx', version: 'rev1', urls: ['https://good.mirror/encoder.onnx'], sha256: sha })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('没有标记 / 标记不符 / 长度对不上：删掉', async () => {
    const sha = await sha256Hex(GOOD)
    const c = await storage.open('model-cache-v1')
    await c.put(KEY, new Response(GOOD.slice(0))) // 无标记
    expect(await pruneModel('m/encoder.onnx', 'rev1', sha)).toBe(false)
    expect(await cached()).toBeUndefined()

    await c.put(KEY, new Response(GOOD.slice(0), { headers: { 'x-model-sha256': 'deadbeef', 'x-model-length': String(GOOD.byteLength) } }))
    expect(await pruneModel('m/encoder.onnx', 'rev1', sha)).toBe(false)
    expect(await cached()).toBeUndefined()

    // 写入被截断：标记对，但实际字节比标记的长度短
    await c.put(KEY, new Response(GOOD.slice(0, 5), { headers: { 'x-model-sha256': sha, 'x-model-length': String(GOOD.byteLength) } }))
    expect(await pruneModel('m/encoder.onnx', 'rev1', sha)).toBe(false)
    expect(await cached()).toBeUndefined()
  })

  it('只动指定条目，别的文件缓存不受影响', async () => {
    const sha = await sha256Hex(GOOD)
    const c = await storage.open('model-cache-v1')
    await c.put(KEY, new Response(enc('坏的')))
    await c.put(OTHER_KEY, new Response(enc('别的文件')))
    expect(await pruneModel('m/encoder.onnx', 'rev1', sha)).toBe(false)
    expect(await c.match(OTHER_KEY)).toBeDefined()
  })
})
