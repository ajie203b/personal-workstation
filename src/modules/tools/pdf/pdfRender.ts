/**
 * pdf.js 侧：缩略图懒渲染 + PDF 栅格化出图。
 *
 * worker 与 cmaps 配置照抄 PdfReader.tsx（public 下的 pdfjs 静态资源由 vite-static-copy 拷入）。
 * 注意 getDocument 的 data 会被 transfer（detached），所以入参字节必须先 slice 一份，
 * 否则同一份 Uint8Array 第二次加载直接崩。
 */
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const PDF_OPTIONS = {
  cMapUrl: 'pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'pdfjs/standard_fonts/',
}

export type { PDFDocumentProxy, PDFPageProxy }

/** 打开文档（字节会被复制，调用方可继续持有原数据） */
export async function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDF_OPTIONS })
  try { return await task.promise }
  catch (e) { void task.destroy(); throw e }
}

/** 串行渲染队列：缩略图一屏十几张一起渲会把主线程和显存一起打满 */
let renderChain: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = renderChain.then(job, job)
  renderChain = run.catch(() => undefined)
  return run
}

function renderToCanvas(page: PDFPageProxy, scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 canvas')
  return { canvas, ctx }
}

function safeScale(page: PDFPageProxy, scale: number): number {
  const size = page.getViewport({ scale: 1 })
  return Math.min(scale, Math.sqrt(16_000_000 / (size.width * size.height)), 8192 / Math.max(size.width, size.height))
}

/** 小缩略图（scale≈0.2）→ PNG dataURL；走串行队列 */
export async function renderPageThumb(page: PDFPageProxy, scale = 0.2): Promise<string> {
  return enqueue(async () => {
    scale = safeScale(page, scale)
    const { canvas, ctx } = renderToCanvas(page, scale)
    try {
      await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise
      return canvas.toDataURL('image/png')
    } finally { canvas.width = 0; canvas.height = 0 }
  })
}

/** 按 DPI 栅格化单页：scale = dpi / 72（PDF 的 1pt = 1/72 英寸） */
export async function renderPageRaster(
  page: PDFPageProxy,
  opts: { dpi: number; format: 'png' | 'jpeg'; quality?: number; signal?: AbortSignal },
): Promise<Blob> {
  return enqueue(async () => {
    opts.signal?.throwIfAborted()
    const scale = safeScale(page, Math.min(6, Math.max(0.5, opts.dpi / 72)))
    const { canvas, ctx } = renderToCanvas(page, scale)
    // JPEG 没有透明通道，先铺白底，否则透明区会变黑
    if (opts.format === 'jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    const task = page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }) })
    const cancel = () => task.cancel()
    opts.signal?.addEventListener('abort', cancel, { once: true })
    try {
      await task.promise
      opts.signal?.throwIfAborted()
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, opts.format === 'png' ? 'image/png' : 'image/jpeg', Math.max(0.1, Math.min(1, opts.quality ?? 0.92))),
      )
      if (!blob) throw new Error('页面导出图片失败')
      opts.signal?.throwIfAborted()
      return blob
    } finally { opts.signal?.removeEventListener('abort', cancel); canvas.width = 0; canvas.height = 0 }
  })
}

/** 整份 PDF → 逐页图片（页间让出主线程，进度可回调） */
export async function rasterizePdf(
  bytes: Uint8Array,
  opts: {
    dpi: number
    format: 'png' | 'jpeg'
    baseName: string
    pages?: number[]
    quality?: number
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  },
): Promise<{ name: string; blob: Blob }[]> {
  const doc = await openPdfDocument(bytes)
  try {
    const pageNumbers = opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
    if (!pageNumbers.length || pageNumbers.some(p => !Number.isInteger(p) || p < 1 || p > doc.numPages)) throw new Error('要导出的页码无效')
    const total = pageNumbers.length
    const out: { name: string; blob: Blob }[] = []
    const ext = opts.format === 'png' ? 'png' : 'jpg'
    for (let i = 0; i < total; i++) {
      opts.signal?.throwIfAborted()
      const pageNo = pageNumbers[i]
      const page = await doc.getPage(pageNo)
      const blob = await renderPageRaster(page, { dpi: opts.dpi, format: opts.format, quality: opts.quality, signal: opts.signal })
      out.push({ name: `${opts.baseName}-p${pageNo}.${ext}`, blob })
      opts.onProgress?.(i + 1, total)
      await new Promise((r) => setTimeout(r, 0))
    }
    return out
  } finally {
    await doc.destroy()
  }
}
