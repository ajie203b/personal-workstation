/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'

/**
 * ONNX 推理 Worker（v3.3）：模型加载与推理都关在 Worker 里，主线程只收结果。
 *
 * - COOP/COEP 头在 GitHub Pages / 安卓 WebView 都设不了 → 多线程 wasm 必挂，
 *   一律 `numThreads = 1`。
 * - executionProviders：能开 WebGPU 就用（快），不行降 wasm。
 */

const sessions = new Map<string, ort.InferenceSession>()
let configured = false

function configure(): void {
  if (configured) return
  configured = true
  ort.env.wasm.numThreads = 1
  // 不设 wasmPaths：onnxruntime-web 的 bundle 自带 jsep 的 .mjs，.wasm 由 Vite 打进 assets/。
  // 以前设成相对的 './ort/'，ort 会按 Worker 脚本位置解析成 assets/ort/（不存在）→ 推理初始化 404。
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
    if (msg.type === 'init') {
      configure()
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
    const feeds: Record<string, ort.Tensor> = {}
    for (const [name, t] of Object.entries(msg.inputs)) {
      feeds[name] = new ort.Tensor(t.type as ort.Tensor.Type, t.data, t.dims)
    }
    const results = await session.run(feeds)
    const outputs: Record<string, TensorMsg> = {}
    const transfer: ArrayBuffer[] = []
    for (const [name, t] of Object.entries(results)) {
      outputs[name] = { type: String(t.type), data: t.data as TensorMsg['data'], dims: t.dims.slice() }
      const buf = (t.data as { buffer?: ArrayBuffer }).buffer
      if (buf instanceof ArrayBuffer && !transfer.includes(buf)) transfer.push(buf)
    }
    self.postMessage({ type: 'result', id: msg.id, ok: true, outputs }, transfer)
  } catch (err) {
    const id = (e.data as { id?: number }).id
    self.postMessage({ type: 'result', id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
