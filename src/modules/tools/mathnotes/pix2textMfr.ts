/**
 * Pix2Text MFR 1.5（MIT，breezedeus/pix2text-mfr-1.5）识别器。
 *
 * 模型：VisionEncoderDecoder = DeiT 编码器（384×384 输入，输出 [1, 577, 384]）
 *      + TrOCR 解码器（vocab 1868，use_cache=false 导出：每步把整段 input_ids 重新喂进去）。
 * - encoder_model.onnx：pixel_values[1,3,384,384] → last_hidden_state
 * - decoder_model.onnx：input_ids(int64)[1,L] + encoder_hidden_states → logits[1,L,1868]
 * - decoder_start_token_id = 1（<s>），eos = 2（</s>），pad = 0
 * 贪心解码；置信度按 Pix2Text 的口径取逐步最大概率的几何平均。
 *
 * 模型文件不进安装包：首次打开工具时按下载源顺序下载，存 Cache Storage（lib/modelCache）。
 * 每个文件都带 SHA-256（与 models 分支 pix2text-mfr-1.5/SHA256SUMS 一致）：镜像回了错误内容不会进缓存，
 * 缓存坏了会被删掉重下；ONNX 建会话失败时对内存里的字节重新算 SHA-256：不符（磁盘损坏 / 伪造标记）
 * 才删缓存重下，相符说明文件没问题（内存不足、运行时不支持），保留缓存并把原因告诉用户。
 * 「重试 / 重新加载模型」只清未通过校验的文件（pruneModel），已校验的大文件不重下。
 */
import { deleteModel, getModel, pruneModel, sha256Hex } from '@/lib/modelCache'
import type { TensorData } from '@/lib/onnx'
import { toPixelValues, MFR_INPUT_SIZE, type GrayImage } from './preprocess'
import { decodeIds, parseTokenizer, postProcessLatex, type MfrTokenizer } from './tokenizer'
import { modelFileUrls, DEFAULT_SOURCE, type LoadProgress, type ModelSourceConfig, type Recognizer, type RecognizeOutput } from './recognizer'

export const MFR_REPO = 'breezedeus/pix2text-mfr-1.5'
/** 固定到具体提交，避免上游改动后缓存与模型不一致 */
export const MFR_REVISION = '1cef9f0bdcd6a4c63df7de1311fb0894593340cc'

/** 运行时只用这三个文件；sha256 取自 models 分支 pix2text-mfr-1.5/SHA256SUMS（与 HF 上游逐字节一致） */
export const MFR_FILES = [
  { key: 'encoder', file: 'encoder_model.onnx', mb: 87.5, sha256: '080a3f660f08bc9ebcacdd96e34be6b6400f8c7e62d7cd0dd8251badc37f610b' },
  { key: 'decoder', file: 'decoder_model.onnx', mb: 32.0, sha256: '917deb98e91a0453c5f234f58a0f32f9fb037de8527c7eb4ed394daf9e692f2a' },
  { key: 'tokenizer', file: 'tokenizer.json', mb: 0.11, sha256: '4ffbeb2143e6a38324bb6111b7a8109530d38a076a8439aa5777535f0a32758a' },
] as const
const FILES = MFR_FILES
const byKey = (key: (typeof FILES)[number]['key']) => FILES.find((f) => f.key === key)!

/** 缓存条目标识（modelCache 的 id）；版本另带 MFR_REVISION */
export const mfrCacheId = (file: string) => `pix2text-mfr-1.5/${file}`

const BOS = 1
const EOS = 2
/** 手写算式很短，256 个 token 足够；防止模型复读卡死 */
const MAX_TOKENS = 256

/** 推理运行时（lib/onnx 的 InlineOnnxRunner 满足它；单测可注入 node 版） */
export interface MfrRuntime {
  prepare(key: string, modelBuffer: ArrayBuffer, opts?: { wasmOnly?: boolean }): Promise<void>
  run(key: string, inputs: Record<string, TensorData>): Promise<Record<string, TensorData>>
  provider?(key: string): string | undefined
  drop?(key: string): Promise<void>
}

/** 取文件字节；默认走 modelCache（镜像回退 + SHA-256 校验 + Cache Storage） */
export type FileLoader = (id: string, urls: string[], onProgress: (ratio: number) => void, sha256: string) => Promise<ArrayBuffer>
/** 删掉某个文件的缓存 */
export type CacheEvictor = (id: string) => Promise<void>
/** 检查某个文件的缓存：已校验标记与期望一致就保留（返回 true），否则删掉（返回 false） */
export type CachePruner = (id: string, sha256: string) => Promise<boolean>
/** 建会话失败后复核内存里的字节：与期望 sha256 一致返回 true */
export type BytesVerifier = (buf: ArrayBuffer, sha256: string) => Promise<boolean>

const defaultLoader: FileLoader = (id, urls, onProgress, sha256) =>
  getModel({ id, version: MFR_REVISION, urls, onProgress, sha256 })

const defaultEvict: CacheEvictor = (id) => deleteModel(id, MFR_REVISION)

const defaultPrune: CachePruner = (id, sha256) => pruneModel(id, MFR_REVISION, sha256)

const defaultVerify: BytesVerifier = async (buf, sha256) => (await sha256Hex(buf)) === sha256

/** 模型文件字节与校验值不符：缓存已删，重试会重新下载 */
export class ModelCorruptError extends Error {
  readonly kind = 'corrupt'
  constructor(file: string, cause?: unknown) {
    super(`模型文件 ${file} 已损坏，已清除缓存，点「重试」会重新下载`)
    this.name = 'ModelCorruptError'
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

/** 文件校验无误、但运行时建不了会话：不删缓存，按原因提示 */
export class ModelRuntimeError extends Error {
  constructor(
    readonly kind: 'oom' | 'unsupported' | 'unknown',
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'ModelRuntimeError'
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

const OOM_RE = /out of memory|\boom\b|bad_alloc|allocation failed|failed to allocate|cannot allocate|memory access out of bounds|could not allocate|insufficient memory|内存不足|RangeError: (?:Array buffer|WebAssembly\.Memory)/i
const UNSUPPORTED_RE = /webassembly is not defined|no available backend|not supported|unsupported|SharedArrayBuffer is not defined|wasm.*(?:compile|instantiate)|CompileError|BigInt64Array is not defined/i

/**
 * 校验无误的模型建会话失败：按错误信息归类成面向用户的提示。
 * 内存不足 → 关掉其他应用重试；运行时不支持 → 说明 WebView 版本要求；其余带上原始信息。
 */
export function classifySessionError(e: unknown): ModelRuntimeError {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  if (e instanceof RangeError || OOM_RE.test(raw)) {
    return new ModelRuntimeError('oom', '设备内存不足，识别模型没能加载：关闭其他应用后点「重试」（模型文件已在本机，不会重新下载）', e)
  }
  if (UNSUPPORTED_RE.test(raw)) {
    return new ModelRuntimeError('unsupported', '当前环境不支持离线识别模型：安卓需 Android System WebView / Chrome 93 及以上（模型文件已在本机，升级后点「重试」即可）', e)
  }
  const detail = e instanceof Error ? e.message : String(e)
  return new ModelRuntimeError('unknown', `识别模型初始化失败（模型文件校验无误，未重新下载）：${detail}`, e)
}

export interface Pix2TextMfrOptions {
  runtime: MfrRuntime
  source?: ModelSourceConfig
  loader?: FileLoader
  evict?: CacheEvictor
  prune?: CachePruner
  verify?: BytesVerifier
}

/** 取 logits 最后一个位置的 argmax 与 softmax 概率 */
export function lastStepArgmax(logits: Float32Array, seqLen: number, vocab: number): { id: number; prob: number } {
  const off = (seqLen - 1) * vocab
  let best = 0
  let max = -Infinity
  for (let i = 0; i < vocab; i++) {
    const v = logits[off + i]
    if (v > max) {
      max = v
      best = i
    }
  }
  let sum = 0
  for (let i = 0; i < vocab; i++) sum += Math.exp(logits[off + i] - max)
  return { id: best, prob: 1 / sum }
}

export class Pix2TextMfrRecognizer implements Recognizer {
  readonly id = 'pix2text-mfr-1.5'
  readonly label = 'Pix2Text MFR 1.5'
  readonly downloadMB = Math.round(FILES.reduce((s, f) => s + f.mb, 0))

  private tokenizer: MfrTokenizer | null = null
  private loading: Promise<void> | null = null
  private wasmOnly = false
  private readonly runtime: MfrRuntime
  private readonly loader: FileLoader
  private readonly evict: CacheEvictor
  private readonly prune: CachePruner
  private readonly verify: BytesVerifier
  private source: ModelSourceConfig

  constructor(opts: Pix2TextMfrOptions) {
    this.runtime = opts.runtime
    this.loader = opts.loader ?? defaultLoader
    this.evict = opts.evict ?? defaultEvict
    this.prune = opts.prune ?? defaultPrune
    this.verify = opts.verify ?? defaultVerify
    this.source = opts.source ?? DEFAULT_SOURCE
  }

  get backend(): string | undefined {
    return this.runtime.provider?.('mfr-encoder')
  }

  setSource(source: ModelSourceConfig): void {
    this.source = source
  }

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.tokenizer) return Promise.resolve()
    if (!this.loading) {
      this.loading = this.doLoad(onProgress).catch((e) => {
        this.loading = null
        throw e
      })
    }
    return this.loading
  }

  /**
   * 「重试 / 重新加载模型」：释放已建会话，并只清掉未通过校验的文件缓存——
   * 已校验标记（sha256 + 长度）与期望一致的保留，缺失 / 不符 / 损坏的删掉，下次 load 只补下这些。
   * 换源后同理只从新源补下缺的 / 坏的。标记一致但内容不可用（伪造、磁盘损坏）的情况，
   * 由 load 里建会话失败时复核字节、确认不符再清对应文件兜底。返回本次被清掉（需要重下）的文件名。
   */
  async reset(): Promise<string[]> {
    if (this.loading) await this.loading.catch(() => undefined)
    this.tokenizer = null
    this.loading = null
    if (this.runtime.drop) {
      await this.runtime.drop('mfr-encoder').catch(() => undefined)
      await this.runtime.drop('mfr-decoder').catch(() => undefined)
    }
    const cleared: string[] = []
    for (const f of FILES) {
      const kept = await this.prune(mfrCacheId(f.file), f.sha256).catch(async () => {
        // 检查本身出错：保守起见按坏缓存处理
        await this.evict(mfrCacheId(f.file)).catch(() => undefined)
        return false
      })
      if (!kept) cleared.push(f.file)
    }
    return cleared
  }

  private async fetchFile(file: (typeof FILES)[number], done: number, total: number, onProgress?: (p: LoadProgress) => void) {
    const urls = modelFileUrls(this.source, MFR_REPO, MFR_REVISION, file.file)
    return this.loader(
      mfrCacheId(file.file),
      urls,
      (r) => onProgress?.({ ratio: r < 0 ? -1 : (done + r * file.mb) / total, file: file.file }),
      file.sha256,
    )
  }

  /**
   * 建会话 / 解析失败后的处置：先对内存里的字节重新算 SHA-256。
   * - 不符：缓存里的文件确实坏了（磁盘损坏、标记被伪造）→ 删掉，下次加载重新下载
   * - 相符：文件没问题，是内存不足或运行时不支持 → 保留缓存，按原因提示，重试不重新下载
   * 复核本身出错（例如内存不足连哈希都算不动）时不删：宁可保留一份好文件，也不让用户白下 120 MB。
   */
  private async diagnose(file: (typeof FILES)[number], buf: ArrayBuffer, e: unknown): Promise<Error> {
    let intact: boolean
    try {
      intact = await this.verify(buf, file.sha256)
    } catch {
      intact = true
    }
    if (!intact) {
      await this.evict(mfrCacheId(file.file)).catch(() => undefined)
      return new ModelCorruptError(file.file, e)
    }
    return classifySessionError(e)
  }

  private async prepareOrDiagnose(key: string, file: (typeof FILES)[number], buf: ArrayBuffer): Promise<void> {
    try {
      await this.runtime.prepare(key, buf, { wasmOnly: this.wasmOnly })
    } catch (e) {
      throw await this.diagnose(file, buf, e)
    }
  }

  private async doLoad(onProgress?: (p: LoadProgress) => void): Promise<void> {
    const total = FILES.reduce((s, f) => s + f.mb, 0)
    let done = 0
    const buffers: Record<string, ArrayBuffer> = {}
    for (const f of FILES) {
      buffers[f.key] = await this.fetchFile(f, done, total, onProgress)
      done += f.mb
      onProgress?.({ ratio: done / total, file: f.file })
    }
    let tokenizer: MfrTokenizer
    try {
      tokenizer = parseTokenizer(new TextDecoder().decode(buffers.tokenizer))
    } catch (e) {
      throw await this.diagnose(byKey('tokenizer'), buffers.tokenizer, e)
    }
    await this.prepareOrDiagnose('mfr-encoder', byKey('encoder'), buffers.encoder)
    await this.prepareOrDiagnose('mfr-decoder', byKey('decoder'), buffers.decoder)
    this.tokenizer = tokenizer
  }

  async recognize(image: GrayImage): Promise<RecognizeOutput> {
    try {
      return await this.infer(image)
    } catch (e) {
      // WebGPU 建会话成功但推理失败（部分安卓 WebView 常见）：退回 wasm 重来一次
      if (this.wasmOnly || this.backend !== 'webgpu' || !this.runtime.drop) throw e
      this.wasmOnly = true
      await this.runtime.drop('mfr-encoder')
      await this.runtime.drop('mfr-decoder')
      this.tokenizer = null
      this.loading = null
      await this.load()
      return this.infer(image)
    }
  }

  private async infer(image: GrayImage): Promise<RecognizeOutput> {
    await this.load()
    const tok = this.tokenizer
    if (!tok) throw new Error('识别模型未加载')
    const t0 = performance.now()
    const pixelValues = toPixelValues(image)
    const enc = await this.runtime.run('mfr-encoder', {
      pixel_values: { type: 'float32', data: pixelValues, dims: [1, 3, MFR_INPUT_SIZE, MFR_INPUT_SIZE] },
    })
    const hidden = enc.last_hidden_state ?? Object.values(enc)[0]
    if (!hidden) throw new Error('编码器没有输出')
    const encoderHidden: TensorData = { type: 'float32', data: hidden.data as Float32Array, dims: hidden.dims }

    const ids: number[] = [BOS]
    let logProbSum = 0
    let steps = 0
    for (let step = 0; step < MAX_TOKENS; step++) {
      const out = await this.runtime.run('mfr-decoder', {
        input_ids: { type: 'int64', data: BigInt64Array.from(ids, (v) => BigInt(v)), dims: [1, ids.length] },
        encoder_hidden_states: encoderHidden,
      })
      const logits = out.logits ?? Object.values(out)[0]
      if (!logits) throw new Error('解码器没有输出')
      const vocab = logits.dims[logits.dims.length - 1]
      const { id, prob } = lastStepArgmax(logits.data as Float32Array, ids.length, vocab)
      logProbSum += Math.log(prob + 1e-8)
      steps++
      if (id === EOS) break
      ids.push(id)
    }
    const latex = postProcessLatex(decodeIds(tok, ids))
    return { latex, confidence: steps ? Math.exp(logProbSum / steps) : 0, ms: Math.round(performance.now() - t0) }
  }
}
