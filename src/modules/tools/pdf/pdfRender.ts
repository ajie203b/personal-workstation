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
  return pdfjs.getDocument({ data: bytes.slice(), ...PDF_OPTIONS }).promise
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

/** 小缩略图（scale≈0.2）→ PNG dataURL；走串行队列 */
export async function renderPageThumb(page: PDFPageProxy, scale = 0.2): Promise<string> {
  return enqueue(async () => {
    const { canvas, ctx } = renderToCanvas(page, scale)
    await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise
    return canvas.toDataURL('image/png')
  })
}

/** 按 DPI 栅格化单页：scale = dpi / 72（PDF 的 1pt = 1/72 英寸） */
export async function renderPageRaster(
  page: PDFPageProxy,
  opts: { dpi: number; format: 'png' | 'jpeg' },
): Promise<Blob> {
  return enqueue(async () => {
    const scale = Math.min(6, Math.max(0.5, opts.dpi / 72))
    const { canvas, ctx } = renderToCanvas(page, scale)
    // JPEG 没有透明通道，先铺白底，否则透明区会变黑
    if (opts.format === 'jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, opts.format === 'png' ? 'image/png' : 'image/jpeg', 0.92),
    )
    if (!blob) throw new Error('页面导出图片失败')
    return blob
  })
}

/** 整份 PDF → 逐页图片（页间让出主线程，进度可回调） */
export async function rasterizePdf(
  bytes: Uint8Array,
  opts: {
    dpi: number
    format: 'png' | 'jpeg'
    baseName: string
    onProgress?: (done: number, total: number) => void
  },
): Promise<{ name: string; blob: Blob }[]> {
  const doc = await openPdfDocument(bytes)
  try {
    const total = doc.numPages
    const out: { name: string; blob: Blob }[] = []
    const ext = opts.format === 'png' ? 'png' : 'jpg'
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i)
      const blob = await renderPageRaster(page, { dpi: opts.dpi, format: opts.format })
      out.push({ name: `${opts.baseName}-p${i}.${ext}`, blob })
      opts.onProgress?.(i, total)
      await new Promise((r) => setTimeout(r, 0))
    }
    return out
  } finally {
    await doc.destroy()
  }
}
