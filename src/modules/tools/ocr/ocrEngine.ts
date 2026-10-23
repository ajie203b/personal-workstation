/**
 * 本地 OCR 推理引擎（v3.3）：模型下载 + det/rec 推理 + 后处理编排。
 *
 * 跑在 Worker 里（ocr.worker.ts 调它），主线程只收进度与结果。
 * 模型走 lib/modelCache 的镜像回退与 Cache Storage 缓存，推理走 lib/onnx 的
 * WebGPU→WASM 降级 Worker。
 */
import { getModel, type ModelSpec } from '@/lib/modelCache'
import { getOnnxRunner, type TensorData } from '@/lib/onnx'
import {
  DEFAULT_DB_OPTIONS,
  boxesFromProbMap,
  cropRgba,
  ctcGreedyDecode,
  dedupeQuads,
  parseCharset,
  planDetTiles,
  recStripSize,
  resizeRgba,
  scaleQuad,
  sortByReadingOrder,
  toDetTensor,
  toRecTensor,
  warpQuadRgba,
  type DbPostOptions,
  type Quad,
} from './ocrPipeline'

/**
 * 模型清单：PaddleOCR PP-OCRv4 mobile（det + rec）+ ppocr 字典。
 *
 * 出处：
 * - det / rec ONNX 来自 RapidAI/RapidOCR 模型仓库（Paddle2ONNX 导出，输入名 x；
 *   det 输出 sigmoid 概率图 [1,1,H,W]，rec 输出 softmax [1,T,6625]，
 *   6625 = blank + 6623 字符 + 空格，已按 ppocr_keys_v1.txt 对齐）。
 *   https://www.modelscope.cn/models/RapidAI/RapidOCR （国内直连，支持 Range）
 *   备用：huggingface.co（hf-mirror 现已 308 跳回 huggingface.co，已移除）
 * - 字典 ppocr_keys_v1.txt 出自 PaddlePaddle/PaddleOCR release/2.7
 *   （6623 行，与 rec 输出类别数对齐），jsDelivr 提供 CDN。
 *
 * v5 mobile 模型同仓库 onnx/PP-OCRv5/** 可按同规格替换（rec 输出类别数会变，
 * 届时换 ppocrv5_dict.txt 并更新 rec 的 classes）。
 */
export const MODEL_SPEC = {
  det: {
    id: 'ppocr-v4-det-mobile',
    version: '2025.06.01',
    urls: [
      'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx',
      'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx',
    ],
  },
  rec: {
    id: 'ppocr-v4-rec-mobile',
    version: '2025.06.01',
    urls: [
      'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx',
      'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx',
    ],
  },
  dict: {
    id: 'ppocr-keys-v1',
    version: 'release/2.7',
    urls: [
      // App 自带（public/models，26KB）；jsDelivr / raw.githubusercontent 国内常不通
      'models/ppocr_keys_v1.txt',
      'https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@release/2.7/ppocr/utils/ppocr_keys_v1.txt',
      'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/ppocr_keys_v1.txt',
    ],
  },
} satisfies Record<'det' | 'rec' | 'dict', Omit<ModelSpec, 'onProgress'>>

/** 识别结果的一行 */
export interface OcrLine {
  /** 识别文本 */
  text: string
  /** 四点框（左上、右上、右下、左下），源图像素坐标 */
  box: Quad
  /** 平均置信度 0~1 */
  confidence: number
}

/** 推理进度阶段：下载模型 / 推理 */
export type OcrPhase = 'download' | 'infer'

export interface OcrProgress {
  phase: OcrPhase
  /** 0~1；-1 表示无法计量 */
  ratio: number
}

export interface RunOcrOptions {
  onProgress?: (p: OcrProgress) => void
  /** 每行识别之间的协作取消点 */
  signal?: { aborted: boolean }
  db?: Partial<DbPostOptions>
}

export interface OcrResult {
  lines: OcrLine[]
  /** 送识别的图尺寸 */
  width: number
  height: number
}

/** 下载 det/rec/字典三个资产，进度归一到 0~1 */
async function loadAssets(onProgress?: (ratio: number) => void): Promise<{ det: ArrayBuffer; rec: ArrayBuffer; charset: string[] }> {
  const specs = [MODEL_SPEC.det, MODEL_SPEC.rec, MODEL_SPEC.dict]
  const buffers: ArrayBuffer[] = []
  for (let i = 0; i < specs.length; i++) {
    const buf = await getModel({
      ...specs[i],
      onProgress: (r) => onProgress?.((i + Math.max(0, r)) / specs.length),
    })
    buffers.push(buf)
    onProgress?.((i + 1) / specs.length)
  }
  const charset = parseCharset(new TextDecoder().decode(buffers[2]))
  return { det: buffers[0], rec: buffers[1], charset }
}

function firstOutput(outputs: Record<string, TensorData>): TensorData {
  const values = Object.values(outputs)
  if (!values.length) throw new Error('模型没有输出')
  return values[0]
}

/**
 * OCR 主管线：预处理 → 检测 → DB 后处理 → 阅读顺序 → 逐框透视裁剪 → 识别 → CTC 解码。
 * 输入是 RGBA 像素（主线程解码好传进来），输出每行文本 + 四点框 + 置信度。
 */
export async function runOcr(image: { data: Uint8ClampedArray; width: number; height: number }, options: RunOcrOptions = {}): Promise<OcrResult> {
  const { onProgress, signal } = options
  onProgress?.({ phase: 'download', ratio: 0 })
  const assets = await loadAssets((ratio) => onProgress?.({ phase: 'download', ratio }))
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

  const runner = getOnnxRunner()
  await runner.prepare('ppocr-det', assets.det)
  await runner.prepare('ppocr-rec', assets.rec)
  onProgress?.({ phase: 'infer', ratio: 0.05 })
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

  // 1+2. 检测：按 planDetTiles 规划（短边 ≤ 960，超长图沿长边切块），
  // 每块 BGR + ImageNet 归一化 → det → DB 后处理 → 映射回源图坐标
  const tiles = planDetTiles(image.width, image.height)
  const allQuads: Quad[] = []
  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t]
    const tileRgba =
      tiles.length === 1 ? image.data : cropRgba(image.data, image.width, tile.x, tile.y, tile.width, tile.height)
    const resized = resizeRgba(tileRgba, tile.width, tile.height, tile.detWidth, tile.detHeight)
    const detInput = toDetTensor(resized, tile.detWidth, tile.detHeight)
    const detOut = await runner.run('ppocr-det', {
      x: { type: 'float32', data: detInput, dims: [1, 3, tile.detHeight, tile.detWidth] },
    })
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const detMap = firstOutput(detOut)
    const prob = detMap.data as Float32Array
    const probH = detMap.dims[detMap.dims.length - 2] ?? tile.detHeight
    const probW = detMap.dims[detMap.dims.length - 1] ?? tile.detWidth
    const detQuads = boxesFromProbMap(prob, probW, probH, { ...DEFAULT_DB_OPTIONS, ...options.db })
    for (const q of detQuads) {
      const scaled = scaleQuad(q, tile.width / probW, tile.height / probH)
      allQuads.push(scaled.map((p) => ({ x: p.x + tile.x, y: p.y + tile.y })) as Quad)
    }
    onProgress?.({ phase: 'infer', ratio: 0.05 + (0.2 * (t + 1)) / tiles.length })
  }
  const quads = tiles.length > 1 ? dedupeQuads(allQuads) : allQuads

  // 3. 阅读顺序：按 y 分行、行内按 x
  const ordered = sortByReadingOrder(quads)

  // 4. 逐框透视裁剪 → 识别 → CTC 贪心解码
  const lines: OcrLine[] = []
  for (let i = 0; i < ordered.length; i++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const quad = ordered[i]
    const size = recStripSize(quad)
    const strip = warpQuadRgba(image.data, image.width, image.height, quad, size.width, size.height)
    const recInput = toRecTensor(strip, size.width, size.height)
    const recOut = await runner.run('ppocr-rec', {
      x: { type: 'float32', data: recInput, dims: [1, 3, size.height, size.width] },
    })
    const recMap = firstOutput(recOut)
    const probs = recMap.data as Float32Array
    // rec 输出 [1, T, classes]
    const classes = recMap.dims[recMap.dims.length - 1] ?? probs.length
    const timeSteps = recMap.dims[recMap.dims.length - 2] ?? Math.floor(probs.length / classes)
    const { text, confidence } = ctcGreedyDecode(probs, timeSteps, classes, assets.charset)
    if (text.trim()) lines.push({ text, box: quad, confidence })
    onProgress?.({ phase: 'infer', ratio: 0.25 + (0.75 * (i + 1)) / ordered.length })
  }

  return { lines, width: image.width, height: image.height }
}
