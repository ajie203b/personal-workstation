/// <reference lib="webworker" />
/**
 * ONNX 推理 Worker（v3.3）：模型加载与推理都关在 Worker 里，主线程只收结果。
 *
 * - 动态 import('onnxruntime-web')，与 InlineOnnxRunner 共享同一个 ort.bundle.min chunk。
 * - COOP/COEP 头在 GitHub Pages / 安卓 WebView 都设不了 → 多线程 wasm 必挂，
 *   一律 `numThreads = 1`。
 * - executionProviders：能开 WebGPU 就用（快），不行降 wasm。
 */

type OrtModule = typeof import('onnxruntime-web')
type InferenceSession = import('onnxruntime-web').InferenceSession
type TensorType = import('onnxruntime-web').Tensor.Type

let ortPromise: Promise<OrtModule> | null = null
const sessions = new Map<string, InferenceSession>()

async function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((ort) => {
      ort.env.wasm.numThreads = 1
      return ort
    })
  }
  return ortPromise
}

interface TensorMsg {
  type: string
  data: Float32Array | Int32Array | Uint8Array | BigInt64Array
  dims: number[]
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; key: string; modelBuffer: ArrayBuffer }
    | { type: 'run'; id: number; key: string; inputs: Record<string, TensorMsg> }
  try {
    const ort = await getOrt()
    if (msg.type === 'init') {
      if ((navigator as Navigator & { gpu?: unknown }).gpu) {
        try {
          sessions.set(msg.key, await ort.InferenceSession.create(msg.modelBuffer, { executionProviders: ['webgpu'] }))
          self.postMessage({ type: 'ready', key: msg.key, provider: 'webgpu' })
          return
        } catch {
          // 降级 wasm
        }
      }
      sessions.set(msg.key, await ort.InferenceSession.create(msg.modelBuffer, { executionProviders: ['wasm'] }))
      self.postMessage({ type: 'ready', key: msg.key, provider: 'wasm' })
      return
    }
    const session = sessions.get(msg.key)
    if (!session) throw new Error(`模型 ${msg.key} 未初始化`)
    const feeds: Record<string, import('onnxruntime-web').Tensor> = {}
    for (const [name, t] of Object.entries(msg.inputs)) {
      feeds[name] = new ort.Tensor(t.type as TensorType, t.data, t.dims)
    }
    const results = await session.run(feeds)
    const outputs: Record<string, TensorMsg> = {}
    const transfer: ArrayBuffer[] = []
    for (const [name, t] of Object.entries(results)) {
      outputs[name] = { type: String(t.type), data: t.data as TensorMsg['data'], dims: t.dims.slice() }
      if (t.data instanceof ArrayBuffer) transfer.push(t.data)
      else if (ArrayBuffer.isView(t.data)) transfer.push(t.data.buffer as ArrayBuffer)
    }
    self.postMessage({ type: 'result', id: msg.id, ok: true, outputs }, transfer)
  } catch (err) {
    self.postMessage({
      type: 'result',
      id: (msg as { id?: number }).id,
      key: (msg as { key?: string }).key,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
