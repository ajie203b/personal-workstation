import createModule from '@neslinesli93/qpdf-wasm'
import { qpdfArguments, qpdfErrorMessage, validatePdfBytes, type PdfJob, type PdfJobResult } from './qpdfTypes'

interface QpdfRuntime {
  callMain: (args: string[]) => number
  FS: {
    writeFile: (path: string, bytes: Uint8Array) => void
    readFile: (path: string) => Uint8Array
    unlink: (path: string) => void
  }
}

/** 每次操作使用独立 WASM 实例；浏览器端只从专用 Worker 调用。 */
export async function executeQpdf(bytes: Uint8Array, job: PdfJob, opts: {
  wasmUrl?: string
  diagnostics: () => string
  onReady?: () => void
}): Promise<PdfJobResult> {
  validatePdfBytes(bytes)
  const args = qpdfArguments(job)
  // 上游类型未声明 FS.writeFile，接口按实际 Emscripten 导出限定。
  const factory = createModule as unknown as (options: { locateFile: () => string }) => Promise<QpdfRuntime>
  const engine = await factory({ locateFile: () => opts.wasmUrl ?? '' })
    .catch(() => { throw new Error('本地 PDF 引擎加载失败，请刷新重试') })
  engine.FS.writeFile('/input.pdf', bytes)
  try {
    opts.onReady?.()
    const code = engine.callMain(args)
    if (code !== 0 && code !== 3) throw new Error(qpdfErrorMessage(opts.diagnostics()))
    const output = engine.FS.readFile('/output.pdf').slice()
    validatePdfBytes(output)
    const usedOriginal = job.kind === 'compress' && output.length >= bytes.length
    return {
      bytes: usedOriginal ? bytes.slice() : output,
      originalSize: bytes.length,
      outputSize: usedOriginal ? bytes.length : output.length,
      usedOriginal,
      warnings: /WARNING:/i.test(opts.diagnostics()),
    }
  } catch (error) {
    const message = qpdfErrorMessage(opts.diagnostics())
    if (error instanceof Error && /密码不正确|内存不足/.test(error.message)) throw error
    throw new Error(message)
  } finally {
    for (const path of ['/input.pdf', '/output.pdf']) {
      try { engine.FS.unlink(path) } catch { /* 失败时可能没有输出文件。 */ }
    }
  }
}
