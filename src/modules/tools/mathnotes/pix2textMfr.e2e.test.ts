/**
 * 端到端识别测试：合成手写 → 栅格化 → Pix2Text MFR（onnxruntime-web 的 wasm 后端跑在 node 里）。
 * 模型 120MB 不进仓库，默认跳过；本地验证时：
 *   MFR_MODEL_DIR=/path/to/pix2text-mfr-1.5 npx vitest run src/modules/tools/mathnotes/pix2textMfr.e2e.test.ts
 * 目录里放 encoder_model.onnx、decoder_model.onnx、tokenizer.json（HF 原样下载）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TensorData } from '@/lib/onnx'
import { Pix2TextMfrRecognizer, type MfrRuntime } from './pix2textMfr'
import { rasterizeStrokes } from './preprocess'
import { estimateCharHeight } from './geometry'
import { writeText } from './testInk'
import { computeLatex } from './compute'

const dir = process.env.MFR_MODEL_DIR

async function nodeRuntime(): Promise<MfrRuntime> {
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = 1
  const sessions = new Map<string, import('onnxruntime-web').InferenceSession>()
  return {
    async prepare(key, buf) {
      if (!sessions.has(key)) sessions.set(key, await ort.InferenceSession.create(new Uint8Array(buf)))
    },
    async run(key, inputs) {
      const s = sessions.get(key)!
      const feeds: Record<string, import('onnxruntime-web').Tensor> = {}
      for (const [k, t] of Object.entries(inputs)) feeds[k] = new ort.Tensor(t.type, t.data, t.dims)
      const res = await s.run(feeds)
      const out: Record<string, TensorData> = {}
      for (const [k, t] of Object.entries(res)) out[k] = { type: t.type as TensorData['type'], data: t.data as TensorData['data'], dims: [...t.dims] }
      return out
    },
  }
}

describe.skipIf(!dir)('Pix2Text MFR 端到端', () => {
  it('识别合成手写算式', async () => {
    const rec = new Pix2TextMfrRecognizer({
      runtime: await nodeRuntime(),
      loader: async (id) => {
        const file = id.split('/').pop()!
        const buf = readFileSync(join(dir!, file))
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
    })
    await rec.load()
    const cases = ['12+34=', '7x-5', '(2+3)', '3x+1=7', '25-9=']
    for (const text of cases) {
      const strokes = writeText(text, 10, 10, 40)
      const img = rasterizeStrokes(strokes, estimateCharHeight(strokes))
      const out = await rec.recognize(img)
      const result = computeLatex(out.latex)
      console.log(`${text} → ${out.latex}  (conf ${out.confidence.toFixed(3)}, ${out.ms}ms) → ${result.kind} ${result.latex}`)
      expect(out.latex.length).toBeGreaterThan(0)
      if (text === '12+34=') expect(result).toMatchObject({ kind: 'inline', text: '46' })
    }
  }, 300_000)
})
