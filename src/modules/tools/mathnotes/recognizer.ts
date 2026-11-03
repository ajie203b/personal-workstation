/**
 * 公式识别器抽象：UI / Worker 只认这个接口，换模型（如 TexTeller）只需新增一个实现
 * 并在 RECOGNIZERS 里登记，不动画布和计算逻辑。
 */
import type { GrayImage } from './preprocess'

export interface RecognizeOutput {
  /** 识别出的 LaTeX（已做基础清理） */
  latex: string
  /** 逐 token 最大概率的几何平均，0~1（与 Pix2Text 的 score 同口径） */
  confidence: number
  /** 推理耗时（毫秒） */
  ms: number
}

export interface LoadProgress {
  /** 0~1；-1 表示无法计量 */
  ratio: number
  /** 正在处理的文件 */
  file: string
}

export interface Recognizer {
  /** 稳定标识，如 'pix2text-mfr-1.5' */
  readonly id: string
  /** 给人看的名字 */
  readonly label: string
  /** 首次下载的大致体积（MB），用于界面提示 */
  readonly downloadMB: number
  /** 下载（或命中缓存）并建推理会话；幂等 */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>
  /** 识别一张白底黑字灰度图 */
  recognize(image: GrayImage): Promise<RecognizeOutput>
  /** 实际用上的推理后端（webgpu / wasm），加载后才有 */
  readonly backend?: string
}

/* ============ 下载源 ============ */

export type ModelSourceId = 'github' | 'hf' | 'hf-mirror' | 'custom'

export interface ModelSourceOption {
  id: ModelSourceId
  label: string
  hint: string
}

export const MODEL_SOURCES: ModelSourceOption[] = [
  { id: 'github', label: 'GitHub', hint: '本仓库 models 分支的原样镜像（raw.githubusercontent.com），默认' },
  { id: 'hf', label: 'Hugging Face', hint: '官方主站，境外网络更快' },
  { id: 'hf-mirror', label: 'hf-mirror.com', hint: '第三方镜像，部分网络会跳回 huggingface.co' },
  { id: 'custom', label: '自定义', hint: '填一个直接放着三个模型文件的目录地址（自建 ModelScope 仓库、局域网文件服务器等）' },
]

export interface ModelSourceConfig {
  preferred: ModelSourceId
  /**
   * custom 时的「文件所在目录」地址：其下直接放 encoder_model.onnx / decoder_model.onnx / tokenizer.json。
   * 例：自己在 ModelScope 建的仓库 https://www.modelscope.cn/models/<你>/pix2text-mfr-1.5/resolve/master
   * 或局域网 http://192.168.1.10:8000/pix2text-mfr-1.5
   */
  customBase?: string
}

export const DEFAULT_SOURCE: ModelSourceConfig = { preferred: 'github' }

/**
 * 自己仓库的孤立分支 models（不含源码历史）里放着与 HF 上游逐字节相同的模型文件，
 * 目录名 = HF 仓库名的最后一段（breezedeus/pix2text-mfr-1.5 → pix2text-mfr-1.5/）。
 * raw.githubusercontent.com 带 `Access-Control-Allow-Origin: *`，浏览器可直接 fetch；
 * GitHub Release 资产不带 CORS，所以不用 Release。
 */
export const GITHUB_MODELS_BASE = 'https://raw.githubusercontent.com/ajie203b/personal-workstation/models'

/** 内置源的回退顺序：首选源提到最前，其余按这个顺序 */
const BUILTIN_ORDER: Exclude<ModelSourceId, 'custom'>[] = ['github', 'hf', 'hf-mirror']

function builtinUrl(id: Exclude<ModelSourceId, 'custom'>, repo: string, revision: string, file: string): string {
  switch (id) {
    case 'github':
      return `${GITHUB_MODELS_BASE}/${repo.split('/').pop()}/${file}`
    case 'hf':
      return `https://huggingface.co/${repo}/resolve/${revision}/${file}`
    case 'hf-mirror':
      return `https://hf-mirror.com/${repo}/resolve/${revision}/${file}`
  }
}

/**
 * 某个文件的候选下载地址：首选源在前，其余源作为回退（modelCache 会按顺序重试，连不上 20 秒换下一个）。
 * 默认顺序：自己仓库 raw → huggingface.co → hf-mirror.com（实测 hf-mirror 对部分 IP 会 308 跳回 huggingface.co）。
 * 国内直连都不通时用「自定义」指向自建镜像。
 */
export function modelFileUrls(cfg: ModelSourceConfig, repo: string, revision: string, file: string): string[] {
  const urls: string[] = []
  const custom = cfg.customBase?.trim().replace(/\/+$/, '')
  if (cfg.preferred === 'custom' && custom) urls.push(`${custom}/${file}`)
  const first = BUILTIN_ORDER.find((id) => id === cfg.preferred)
  const order = first ? [first, ...BUILTIN_ORDER.filter((id) => id !== first)] : BUILTIN_ORDER
  for (const id of order) urls.push(builtinUrl(id, repo, revision, file))
  return [...new Set(urls)]
}
