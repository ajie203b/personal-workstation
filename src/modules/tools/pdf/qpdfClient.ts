import type { PdfJob, PdfJobResult, PdfProgress } from './qpdfTypes'

/** 终止 Worker 即取消，包括 WASM 同步执行期间；结束后内存与密码随 Worker 释放。 */
export function runPdfJob(bytes: Uint8Array, job: PdfJob, opts: { signal?: AbortSignal; onProgress?: (progress: PdfProgress) => void } = {}): Promise<PdfJobResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new DOMException('操作已取消', 'AbortError')); return }
    const worker = new Worker(new URL('./qpdf.worker.ts', import.meta.url), { type: 'module' })
    const clean = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { clean(); reject(new DOMException('操作已取消', 'AbortError')) }
    const timer = setTimeout(() => { clean(); reject(new Error('处理超时，请拆分文档后重试')) }, 180000)
    opts.signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg.type === 'progress') { opts.onProgress?.({ percent: msg.percent, label: msg.label }); return }
      clean()
      if (msg.type === 'result') resolve(msg.result as PdfJobResult)
      else reject(new Error(msg.message || 'PDF 处理失败'))
    }
    worker.onerror = () => { clean(); reject(new Error('PDF 引擎未能加载，请刷新后重试')) }
    worker.onmessageerror = () => { clean(); reject(new Error('PDF 处理结果读取失败')) }
    try { worker.postMessage({ bytes, job }) }
    catch { clean(); reject(new Error('PDF 任务无法启动，请重试')) }
  })
}
