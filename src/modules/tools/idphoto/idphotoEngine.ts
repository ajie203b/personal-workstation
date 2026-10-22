/**
 * 抠图 / 人脸推理编排（v3.3）：模型下载（lib/modelCache 镜像回退）+ ONNX 推理
 * （lib/onnx 的 WebGPU→WASM Worker）+ MediaPipe 人脸/分割。
 *
 * 抠图主路径：MODNet ONNX（人像抠图，发丝级 alpha）。
 * MODNet 镜像全挂时降级：@mediapipe/tasks-vision 的 ImageSegmenter 自拍分割
 * （只有二值级 alpha，边缘较粗，界面会注明）。
 *
 * 下载 / 推理失败都抛中文错误（「模型没拉下来，换个网络再试」），由页面展示，不白屏。
 */
import { FilesetResolver, FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision'
import { getModel, type ModelSpec } from '@/lib/modelCache'
import { getOnnxRunner } from '@/lib/onnx'
import {
  estimateBackground,
  featherAlpha,
  removeColorSpill,
  resizeAlpha,
  resizeRgba,
} from './idphotoAlpha'
import { facePointsFromNormalized, type FacePoints } from './idphotoCrop'

/**
 * MODNet（Trimap-Free Portrait Matting, AAAI 2022）ONNX 模型清单。
 *
 * 出处与镜像（按顺序回退）：
 * 1. ModelScope `Xenova/modnet`（国内直连）—— Xenova 用 🤗 Optimum 从
 *    ZHKKKe/MODNet 官方权重导出的 ONNX，供 transformers.js 使用；
 *    输入名 `input` [1,3,H,W] float32（(v/255-0.5)/0.5 归一化），输出 `output` [1,1,H,W] alpha。
 *    https://www.modelscope.cn/models/Xenova/modnet
 * 2. huggingface 的 `Xenova/modnet` 兜底（hf-mirror 现已 308 跳回 huggingface.co，国内不可用，已移除）。
 *
 * 权重均为 MODNet 官方（Apache-2.0）转换而来；v1 用 fp32 全量（约 25MB），
 * 网络差时可换同一仓库的 onnx/model_quantized.onnx。
 */
export const MODNET_SPEC = {
  id: 'modnet-portrait-matting',
  // 版本号变了 modelCache 会重下；取上游仓库最后更新时间
  version: '2025-05-16',
  urls: [
    'https://www.modelscope.cn/models/Xenova/modnet/resolve/master/onnx/model.onnx',
    'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
  ],
} satisfies Omit<ModelSpec, 'onProgress'>

/** App 自带资源的绝对地址（安卓 https://localhost/、Pages 子路径都对） */
function localAsset(path: string): string {
  return new URL(path, document.baseURI).href
}

/**
 * MediaPipe wasm（FaceDetector / ImageSegmenter 共用）：
 * App 自带（构建时从 node_modules 拷进 mediapipe/）→ jsDelivr → npmmirror。
 * 国内 jsDelivr 时好时坏，自带的优先。
 */
export const VISION_WASM_URLS = (): string[] => [
  localAsset('mediapipe'),
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm',
  'https://registry.npmmirror.com/@mediapipe/tasks-vision/1.1.1/files/wasm',
]

/** BlazeFace 短距人脸检测（6 个关键点）：App 自带（public/models）→ MediaPipe 官方（storage.googleapis.com，国内不通） */
export const FACE_DETECTOR_URLS = (): string[] => [
  localAsset('models/blaze_face_short_range.tflite'),
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
]

/** 自拍人像分割（降级抠图用；输出人物置信度当 alpha） */
export const SELFIE_SEGMENTER_URLS = (): string[] => [
  localAsset('models/selfie_segmenter.tflite'),
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
]

/** 工作图像素（RGBA，与 canvas ImageData 同布局） */
export interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type MattingEngine = 'modnet' | 'selfie-segmenter'

export interface MattingResult {
  /** 0~1 的 alpha（已 1.5px 羽化），长度 width*height */
  alpha: Float32Array
  /** 与输入同尺寸、已去溢出的 RGBA（发丝不带原底色） */
  cleaned: Uint8ClampedArray
  width: number
  height: number
  /** 实际用的引擎（降级时页面注明边缘较粗） */
  engine: MattingEngine
}

const MODNET_INPUT_SIZE = 512

/** RGBA → 画布（MediaPipe 只吃 ImageSource） */
function toCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布创建失败')
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  return canvas
}

// ---------- MediaPipe wasm（带镜像回退） ----------

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

/**
 * 依次试 wasm 来源 × 模型来源 × GPU/CPU，直到建出来。
 * forVisionTasks 本身不发请求，真正下载在 createFromOptions，所以回退必须包住它。
 */
async function createVisionTask<T>(
  modelUrls: string[],
  make: (fileset: VisionFileset, modelAssetPath: string, delegate: 'GPU' | 'CPU') => Promise<T>,
): Promise<T> {
  let last: unknown = null
  for (const wasm of VISION_WASM_URLS()) {
    let fileset: VisionFileset
    try {
      fileset = await FilesetResolver.forVisionTasks(wasm)
    } catch (e) {
      last = e
      continue
    }
    for (const model of modelUrls) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          return await make(fileset, model, delegate)
        } catch (e) {
          last = e
        }
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last ?? '加载失败'))
}

// ---------- 人脸定位 ----------

let faceDetector: FaceDetector | null = null

/**
 * 人脸关键点检测；没检测到人脸返回 null（页面降级成手动框）。
 * GPU 委托失败自动退 CPU；模型/组件下载失败抛中文错误。
 */
export async function detectFacePoints(image: RgbaImage): Promise<FacePoints | null> {
  if (!faceDetector) {
    try {
      faceDetector = await createVisionTask(FACE_DETECTOR_URLS(), (fileset, modelAssetPath, delegate) =>
        FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.4,
        }),
      )
    } catch (e) {
      throw new Error(`人脸模型加载失败（${e instanceof Error ? e.message : String(e)}）`)
    }
  }
  const result = faceDetector.detect(toCanvas(image))
  const kps = result.detections?.[0]?.keypoints
  if (!kps || kps.length < 2) return null
  return facePointsFromNormalized(kps, image.width, image.height)
}

// ---------- 抠图 ----------

/** MODNet 预处理：缩到 512×512，RGB + (v/255-0.5)/0.5，NCHW */
function toModnetTensor(image: RgbaImage): { data: Float32Array; size: number } {
  const size = MODNET_INPUT_SIZE
  const small = resizeRgba(image.data, image.width, image.height, size, size)
  const data = new Float32Array(3 * size * size)
  for (let i = 0; i < size * size; i++) {
    data[i] = (small[i * 4] / 255 - 0.5) / 0.5
    data[size * size + i] = (small[i * 4 + 1] / 255 - 0.5) / 0.5
    data[2 * size * size + i] = (small[i * 4 + 2] / 255 - 0.5) / 0.5
  }
  return { data, size }
}

async function runModnet(
  image: RgbaImage,
  onProgress?: (ratio: number) => void,
): Promise<Float32Array> {
  onProgress?.(0)
  const buf = await getModel({ ...MODNET_SPEC, onProgress: (r) => onProgress?.(Math.max(0, r) * 0.6) })
  const runner = getOnnxRunner()
  // prepare 会 transfer buffer，留副本，缓存里的原件才能继续用
  await runner.prepare('modnet', buf.slice(0))
  onProgress?.(0.7)

  const { data, size } = toModnetTensor(image)
  const outputs = await runner.run('modnet', {
    input: { type: 'float32', data, dims: [1, 3, size, size] },
  })
  const out = outputs.output ?? Object.values(outputs)[0]
  if (!out) throw new Error('抠图模型没有输出')
  const raw = out.data as Float32Array
  // 输出 [1,1,H,W] 或 [H,W]，统一取末尾 size×size 个值当 alpha
  const smallAlpha = new Float32Array(size * size)
  const offset = Math.max(0, raw.length - size * size)
  for (let i = 0; i < size * size; i++) {
    const v = raw[offset + i]
    smallAlpha[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  onProgress?.(0.9)
  return resizeAlpha(smallAlpha, size, size, image.width, image.height)
}

/** 降级路径：ImageSegmenter 自拍分割，人物置信度当 alpha（边缘较粗） */
async function runSelfieSegmenter(image: RgbaImage): Promise<Float32Array> {
  let segmenter: ImageSegmenter
  try {
    segmenter = await createVisionTask(SELFIE_SEGMENTER_URLS(), (fileset, modelAssetPath, delegate) =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }),
    )
  } catch (e) {
    throw new Error(`分割模型加载失败（${e instanceof Error ? e.message : String(e)}）`)
  }
  try {
    const result = segmenter.segment(toCanvas(image))
    const mask = result.confidenceMasks?.[0]
    if (!mask) throw new Error('分割模型没有输出')
    const arr = mask.getAsFloat32Array()
    const alpha = new Float32Array(image.width * image.height)
    alpha.set(arr.subarray(0, Math.min(alpha.length, arr.length)))
    mask.close?.()
    return alpha
  } finally {
    segmenter.close?.()
  }
}

/**
 * 人像抠图：MODNet 优先，全挂降级自拍分割。
 * 输出已 1.5px 羽化，并按原背景色去溢出（去发丝白边），页面直接拿 cleaned 合成。
 */
export async function runMatting(
  image: RgbaImage,
  onProgress?: (ratio: number) => void,
): Promise<MattingResult> {
  let alpha: Float32Array
  let engine: MattingEngine
  try {
    alpha = await runModnet(image, onProgress)
    engine = 'modnet'
  } catch (e) {
    // MODNet 全挂 → 降级分割模型；降级也挂就报清楚
    try {
      onProgress?.(0.5)
      alpha = await runSelfieSegmenter(image)
      engine = 'selfie-segmenter'
    } catch {
      throw new Error(
        `抠图模型没拉下来，换个网络再试（${e instanceof Error ? e.message : String(e)}）`,
      )
    }
  }

  const feathered = featherAlpha(alpha, image.width, image.height, 1.5)
  const bg = estimateBackground(image.data, feathered, image.width, image.height)
  const cleaned = removeColorSpill(image.data, feathered, image.width, image.height, bg)
  onProgress?.(1)
  return { alpha: feathered, cleaned, width: image.width, height: image.height, engine }
}
