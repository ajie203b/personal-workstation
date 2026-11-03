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
 */
import { getModel } from '@/lib/modelCache'
import type { TensorData } from '@/lib/onnx'
import { toPixelValues, MFR_INPUT_SIZE, type GrayImage } from './preprocess'
import { decodeIds, parseTokenizer, postProcessLatex, type MfrTokenizer } from './tokenizer'
import { modelFileUrls, DEFAULT_SOURCE, type LoadProgress, type ModelSourceConfig, type Recognizer, type RecognizeOutput } from './recognizer'

export const MFR_REPO = 'breezedeus/pix2text-mfr-1.5'
/** 固定到具体提交，避免上游改动后缓存与模型不一致 */
export const MFR_REVISION = '1cef9f0bdcd6a4c63df7de1311fb0894593340cc'

const FILES = [
  { key: 'encoder', file: 'encoder_model.onnx', mb: 87.5 },
  { key: 'decoder', file: 'decoder_model.onnx', mb: 32.0 },
  { key: 'tokenizer', file: 'tokenizer.json', mb: 0.11 },
] as const

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

/** 取文件字节；默认走 modelCache（镜像回退 + Cache Storage） */
export type FileLoader = (id: string, urls: string[], onProgress: (ratio: number) => void) => Promise<ArrayBuffer>

const defaultLoader: FileLoader = (id, urls, onProgress) =>
  getModel({ id, version: MFR_REVISION, urls, onProgress })

export interface Pix2TextMfrOptions {
  runtime: MfrRuntime
  source?: ModelSourceConfig
  loader?: FileLoader
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
  private source: ModelSourceConfig

  constructor(opts: Pix2TextMfrOptions) {
    this.runtime = opts.runtime
    this.loader = opts.loader ?? defaultLoader
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

  private async fetchFile(file: (typeof FILES)[number], done: number, total: number, onProgress?: (p: LoadProgress) => void) {
    const urls = modelFileUrls(this.source, MFR_REPO, MFR_REVISION, file.file)
    return this.loader(`pix2text-mfr-1.5/${file.file}`, urls, (r) =>
      onProgress?.({ ratio: r < 0 ? -1 : (done + r * file.mb) / total, file: file.file }),
    )
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
    const tokenizer = parseTokenizer(new TextDecoder().decode(buffers.tokenizer))
    await this.runtime.prepare('mfr-encoder', buffers.encoder, { wasmOnly: this.wasmOnly })
    await this.runtime.prepare('mfr-decoder', buffers.decoder, { wasmOnly: this.wasmOnly })
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
