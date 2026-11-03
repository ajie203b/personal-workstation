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
 * 缓存坏了会被删掉重下；ONNX 建会话失败时也清掉对应文件的缓存，下次加载重新下载。
 */
import { deleteModel, getModel } from '@/lib/modelCache'
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

const defaultLoader: FileLoader = (id, urls, onProgress, sha256) =>
  getModel({ id, version: MFR_REVISION, urls, onProgress, sha256 })

const defaultEvict: CacheEvictor = (id) => deleteModel(id, MFR_REVISION)

export interface Pix2TextMfrOptions {
  runtime: MfrRuntime
  source?: ModelSourceConfig
  loader?: FileLoader
  evict?: CacheEvictor
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
  private source: ModelSourceConfig

  constructor(opts: Pix2TextMfrOptions) {
    this.runtime = opts.runtime
    this.loader = opts.loader ?? defaultLoader
    this.evict = opts.evict ?? defaultEvict
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
   * 「重试 / 换源」：先清掉本模型三个文件的缓存与已建会话，下次 load 从头下载。
   * 用户点这两个按钮时多半是坏缓存在作怪（镜像回过错误内容），只换 URL 不清缓存还是读到同一份。
   */
  async reset(): Promise<void> {
    if (this.loading) await this.loading.catch(() => undefined)
    this.tokenizer = null
    this.loading = null
    if (this.runtime.drop) {
      await this.runtime.drop('mfr-encoder').catch(() => undefined)
      await this.runtime.drop('mfr-decoder').catch(() => undefined)
    }
    for (const f of FILES) await this.evict(mfrCacheId(f.file)).catch(() => undefined)
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

  /** 建会话失败：多半是缓存里的模型文件坏了（校验前写进去的旧缓存），删掉让下次重新下载 */
  private async prepareOrEvict(key: string, file: string, buf: ArrayBuffer): Promise<void> {
    try {
      await this.runtime.prepare(key, buf, { wasmOnly: this.wasmOnly })
    } catch (e) {
      await this.evict(mfrCacheId(file)).catch(() => undefined)
      throw e
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
      await this.evict(mfrCacheId('tokenizer.json')).catch(() => undefined)
      throw e
    }
    await this.prepareOrEvict('mfr-encoder', 'encoder_model.onnx', buffers.encoder)
    await this.prepareOrEvict('mfr-decoder', 'decoder_model.onnx', buffers.decoder)
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
