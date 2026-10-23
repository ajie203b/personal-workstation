/// <reference lib="webworker" />
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'
import { executeQpdf } from './qpdfRuntime'
import type { PdfJob } from './qpdfTypes'

// 上游 Emscripten 直接写 console；拦截为内存诊断，避免文件/密码出现在开发者日志中。
let diagnostics = ''
const capture = (...args: unknown[]) => {
  const line = args.map(String).join(' ')
  diagnostics = (diagnostics + line + '\n').slice(-16000)
  const progress = /progress:\s*(\d+)%/.exec(line)
  if (progress) self.postMessage({ type: 'progress', percent: 35 + Math.round(Number(progress[1]) * 0.6), label: `写入结果 ${progress[1]}%` })
}
console.log = capture
console.error = capture
console.warn = capture

self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array; job: PdfJob }>) => {
  try {
    self.postMessage({ type: 'progress', percent: 10, label: '加载本地 PDF 引擎' })
    const result = await executeQpdf(event.data.bytes, event.data.job, {
      wasmUrl, diagnostics: () => diagnostics,
      onReady: () => self.postMessage({ type: 'progress', percent: 35, label: '正在处理 PDF' }),
    })
    self.postMessage({ type: 'result', result }, { transfer: [result.bytes.buffer] })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'PDF 处理失败' })
  } finally {
    diagnostics = ''
  }
}
