/**
 * 识别器 + 模型缓存的恢复路径：坏缓存、镜像回错误内容、ONNX 建会话失败、「重试」按钮。
 * 用内存版 Cache Storage + 假 fetch + 假推理运行时；真实 sha256 换成假文件的 sha256。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCacheStorage } from '@/lib/fakeCacheStorage'
import { getModel, pruneModel, sha256Hex } from '@/lib/modelCache'
import { MFR_FILES, MFR_REVISION, Pix2TextMfrRecognizer, mfrCacheId, type CachePruner, type FileLoader, type MfrRuntime } from './pix2textMfr'
import type { ModelSourceConfig } from './recognizer'

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
const text = (b: ArrayBuffer) => new TextDecoder().decode(b)

const FAKE: Record<string, string> = {
  'encoder_model.onnx': 'ENCODER-OK',
  'decoder_model.onnx': 'DECODER-OK',
  'tokenizer.json': JSON.stringify({ model: { vocab: { '<pad>': 0, '<s>': 1, '</s>': 2, x: 3 } } }),
}

const SOURCE: ModelSourceConfig = { preferred: 'custom', customBase: 'https://bad.mirror/m' }
const GOOD_BASE = 'https://raw.githubusercontent.com/ajie203b/personal-workstation/models/pix2text-mfr-1.5'

let storage: FakeCacheStorage
let fetchMock: ReturnType<typeof vi.fn>
let shaMap: Record<string, string>

/** 真实 sha → 假文件 sha，其余照走生产用的 getModel（镜像回退 + 校验 + 缓存） */
const loader: FileLoader = (id, urls, onProgress, sha256) =>
  getModel({ id, version: MFR_REVISION, urls, onProgress, sha256: shaMap[sha256] })
/** 同理：重试时按假文件的 sha 判断缓存是否已校验 */
const prune: CachePruner = (id, sha256) => pruneModel(id, MFR_REVISION, shaMap[sha256])

/** 某个文件被 fetch 了几次（任意源） */
const fetchedTimes = (file: string) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith(`/${file}`)).length

/** 假运行时：只认正确的模型字节，否则像 onnxruntime 一样建会话失败 */
function fakeRuntime() {
  const prepared = new Map<string, string>()
  const runtime: MfrRuntime = {
    async prepare(key, buf) {
      const s = text(buf)
      const want = key === 'mfr-encoder' ? FAKE['encoder_model.onnx'] : FAKE['decoder_model.onnx']
      if (s !== want) throw new Error(`failed to load model ${key}: protobuf parsing failed`)
      prepared.set(key, s)
    },
    async run() {
      return {}
    },
    async drop(key) {
      prepared.delete(key)
    },
  }
  return { runtime, prepared }
}

/** bad.mirror 一律以 200 回错误页；GitHub 源回正确文件 */
function serveMirrors() {
  fetchMock.mockImplementation(async (url: string) => {
    const file = url.split('/').pop()!
    if (url.startsWith('https://bad.mirror/')) return new Response(enc('<html>镜像错误页</html>'), { status: 200 })
    if (url.startsWith(GOOD_BASE) && FAKE[file]) return new Response(enc(FAKE[file]), { status: 200 })
    return new Response('nope', { status: 404 })
  })
}

async function cacheEntry(file: string): Promise<string | undefined> {
  const c = await storage.open('model-cache-v1')
  const hit = await c.match(`https://model-cache.local/${encodeURIComponent(mfrCacheId(file))}@${encodeURIComponent(MFR_REVISION)}`)
  return hit ? text(await hit.arrayBuffer()) : undefined
}

async function seed(file: string, body: string, headers: Record<string, string> = {}) {
  const c = await storage.open('model-cache-v1')
  await c.put(`https://model-cache.local/${encodeURIComponent(mfrCacheId(file))}@${encodeURIComponent(MFR_REVISION)}`, new Response(enc(body), { headers }))
}

beforeEach(async () => {
  storage = new FakeCacheStorage()
  fetchMock = vi.fn()
  vi.stubGlobal('caches', storage)
  vi.stubGlobal('fetch', fetchMock)
  shaMap = {}
  for (const f of MFR_FILES) shaMap[f.sha256] = await sha256Hex(enc(FAKE[f.file]))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Pix2Text 模型缓存恢复', () => {
  it('运行时文件都带 models 分支 SHA256SUMS 里的校验值', () => {
    expect(Object.fromEntries(MFR_FILES.map((f) => [f.file, f.sha256]))).toEqual({
      'encoder_model.onnx': '080a3f660f08bc9ebcacdd96e34be6b6400f8c7e62d7cd0dd8251badc37f610b',
      'decoder_model.onnx': '917deb98e91a0453c5f234f58a0f32f9fb037de8527c7eb4ed394daf9e692f2a',
      'tokenizer.json': '4ffbeb2143e6a38324bb6111b7a8109530d38a076a8439aa5777535f0a32758a',
    })
  })

  it('首选镜像以 200 返回错误内容：不缓存，自动换下一源加载成功', async () => {
    serveMirrors()
    const { runtime, prepared } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: SOURCE, loader, prune })
    await r.load()
    expect(prepared.get('mfr-encoder')).toBe('ENCODER-OK')
    expect(await cacheEntry('encoder_model.onnx')).toBe('ENCODER-OK')
    expect(await cacheEntry('decoder_model.onnx')).toBe('DECODER-OK')
    // 每个文件都先试过坏镜像
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith('https://bad.mirror/'))).toHaveLength(3)
  })

  it('预置坏缓存（无校验标记）：直接加载即可识破并重下', async () => {
    serveMirrors()
    await seed('encoder_model.onnx', '<html>旧版本缓存的错误页</html>')
    const { runtime } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: { preferred: 'github' }, loader, prune })
    await r.load()
    expect(await cacheEntry('encoder_model.onnx')).toBe('ENCODER-OK')
  })

  it('伪造标记（磁盘损坏等）导致建会话失败：清掉该文件缓存，点「重试」只重下它并恢复', async () => {
    serveMirrors()
    const forged = await sha256Hex(enc(FAKE['encoder_model.onnx']))
    const badBody = 'ENCODER-XX' // 与正确文件等长，标记和长度都对得上
    await seed('encoder_model.onnx', badBody, { 'x-model-sha256': forged, 'x-model-length': String(enc(badBody).byteLength) })
    const { runtime, prepared } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: { preferred: 'github' }, loader, prune })

    await expect(r.load()).rejects.toThrow(/protobuf/)
    // 标记一致也要清：建会话失败 → 对应缓存已删；另外两个已校验文件留着
    expect(await cacheEntry('encoder_model.onnx')).toBeUndefined()
    expect(await cacheEntry('decoder_model.onnx')).toBe('DECODER-OK')
    expect(await cacheEntry('tokenizer.json')).toBe(FAKE['tokenizer.json'])

    // 「重试」= reset（释放会话 + 只清未通过校验的）+ load
    fetchMock.mockClear()
    expect(await r.reset()).toEqual(['encoder_model.onnx'])
    await r.load()
    expect(prepared.get('mfr-encoder')).toBe('ENCODER-OK')
    expect(prepared.get('mfr-decoder')).toBe('DECODER-OK')
    expect(await cacheEntry('encoder_model.onnx')).toBe('ENCODER-OK')
    expect(fetchedTimes('encoder_model.onnx')).toBe(1)
    expect(fetchedTimes('decoder_model.onnx')).toBe(0)
    expect(fetchedTimes('tokenizer.json')).toBe(0)
  })

  it('decoder 缺失、encoder 已校验：重试只下载 decoder', async () => {
    serveMirrors()
    const { runtime, prepared } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: { preferred: 'github' }, loader, prune })
    await r.load()
    const c = await storage.open('model-cache-v1')
    await c.delete(`https://model-cache.local/${encodeURIComponent(mfrCacheId('decoder_model.onnx'))}@${encodeURIComponent(MFR_REVISION)}`)

    fetchMock.mockClear()
    expect(await r.reset()).toEqual(['decoder_model.onnx'])
    // 会话已释放，重建
    expect(prepared.size).toBe(0)
    await r.load()
    expect(fetchedTimes('encoder_model.onnx')).toBe(0)
    expect(fetchedTimes('tokenizer.json')).toBe(0)
    expect(fetchedTimes('decoder_model.onnx')).toBe(1)
    expect(prepared.get('mfr-encoder')).toBe('ENCODER-OK')
    expect(prepared.get('mfr-decoder')).toBe('DECODER-OK')
    expect(await cacheEntry('decoder_model.onnx')).toBe('DECODER-OK')
  })

  it('encoder 缓存坏了（标记不符）：重试只重下 encoder', async () => {
    serveMirrors()
    const { runtime, prepared } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: { preferred: 'github' }, loader, prune })
    await r.load()
    // 模拟坏条目：内容被截断，标记的长度与实际不符
    await seed('encoder_model.onnx', 'ENC', { 'x-model-sha256': shaMap[MFR_FILES[0].sha256], 'x-model-length': '10' })

    fetchMock.mockClear()
    expect(await r.reset()).toEqual(['encoder_model.onnx'])
    expect(await cacheEntry('encoder_model.onnx')).toBeUndefined()
    expect(await cacheEntry('decoder_model.onnx')).toBe('DECODER-OK')
    await r.load()
    expect(fetchedTimes('encoder_model.onnx')).toBe(1)
    expect(fetchedTimes('decoder_model.onnx')).toBe(0)
    expect(fetchedTimes('tokenizer.json')).toBe(0)
    expect(prepared.get('mfr-encoder')).toBe('ENCODER-OK')
    expect(await cacheEntry('encoder_model.onnx')).toBe('ENCODER-OK')
  })

  it('换源后「重新加载模型」：已校验的不动，只从新源补下缺的', async () => {
    serveMirrors()
    const { runtime } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: { preferred: 'custom', customBase: 'https://bad.mirror/only' }, loader, prune })
    // 只有坏镜像 + 内置源；内置 GitHub 源能兜底
    await r.load()
    const c = await storage.open('model-cache-v1')
    await c.delete(`https://model-cache.local/${encodeURIComponent(mfrCacheId('tokenizer.json'))}@${encodeURIComponent(MFR_REVISION)}`)
    r.setSource({ preferred: 'github' })
    fetchMock.mockClear()
    expect(await r.reset()).toEqual(['tokenizer.json'])
    expect(await cacheEntry('encoder_model.onnx')).toBe('ENCODER-OK')
    await r.load()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${GOOD_BASE}/tokenizer.json`)
    expect(await cacheEntry('tokenizer.json')).toBe(FAKE['tokenizer.json'])
  })

  it('全部已校验时重试：不下载任何文件，只重建会话', async () => {
    serveMirrors()
    const { runtime, prepared } = fakeRuntime()
    const r = new Pix2TextMfrRecognizer({ runtime, source: { preferred: 'github' }, loader, prune })
    await r.load()
    fetchMock.mockClear()
    expect(await r.reset()).toEqual([])
    expect(prepared.size).toBe(0)
    await r.load()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prepared.size).toBe(2)
  })
})
