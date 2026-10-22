/**
 * pdf-lib 侧的 PDF 变换（PDF 工具箱）：合并 / 拆分 / 删页 / 旋转 / 印章 / 图转 PDF。
 *
 * 这里只吃字节、出字节，不碰 DOM —— node 环境可直接单测；
 * 画水印 / 页码 / 签名统一走「印章」模型：调用方把文字渲染成透明 PNG（textPng.ts），
 * 这里负责按视觉坐标贴到页面上（自动抵消页面 /Rotate）。不嵌中文字体，产物不膨胀。
 */
import { PDFDocument, degrees, type PDFImage, type PDFPage } from 'pdf-lib'
import {
  cornerRects,
  centerRect,
  imagePageLayout,
  pageInfo as makePageInfo,
  pageNumberRect,
  tileRects,
  visualRectToDraw,
  type ImagePageSize,
  type PageInfo,
  type PageNumberPos,
  type VisualRect,
} from './layout'

/** 一枚印章：贴在某一页的视觉矩形里 */
export interface Stamp {
  /** 0 起的页序号 */
  pageIndex: number
  /** PNG 字节（同一批次里同一数组会被复用嵌入） */
  png: Uint8Array
  rect: VisualRect
  /** 0~1，水印透明度用 */
  opacity?: number
}

/** 长任务每 25 页让出一次主线程，避免大文档把界面卡死 */
const YIELD_EVERY = 25
let sinceYield = 0
async function tick(): Promise<void> {
  if (++sinceYield < YIELD_EVERY) return
  sinceYield = 0
  await new Promise((r) => setTimeout(r, 0))
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  sinceYield = 0
  // ignoreEncryption：加密文档尽量打开（pdf-lib 只能读不能解密正文加密的内容，但常规权限加密可过）
  return PDFDocument.load(bytes, { ignoreEncryption: true })
}

function pageInfos(doc: PDFDocument): PageInfo[] {
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize()
    return makePageInfo(width, height, p.getRotation().angle)
  })
}

/** 多个 PDF 合并成一个（按入参顺序） */
export async function mergePdfs(sources: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of sources) {
    const src = await loadPdf(bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) {
      out.addPage(p)
      await tick()
    }
  }
  return out.save()
}

/** 按页码提取（1 起，保序）合成新 PDF */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await loadPdf(bytes)
  const total = src.getPageCount()
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > total) throw new Error(`页码 ${p} 超出范围：文档共 ${total} 页`)
  }
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pages.map((p) => p - 1))
  for (const p of copied) {
    out.addPage(p)
    await tick()
  }
  return out.save()
}

/** 按分段拆成多个 PDF：groups[i] = 第 i 份输出包含的页码（1 起） */
export async function splitByGroups(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for (const g of groups) out.push(await extractPages(bytes, g))
  return out
}

/** 删页 + 旋转一步到位（页码 1 起；rotate 为在原角度上追加的度数） */
export async function applyPageOps(
  bytes: Uint8Array,
  opts: { remove?: Iterable<number>; rotate?: Record<number, number> },
): Promise<Uint8Array> {
  const src = await loadPdf(bytes)
  const remove = new Set(opts.remove ?? [])
  const total = src.getPageCount()
  const keep: number[] = []
  for (let i = 1; i <= total; i++) if (!remove.has(i)) keep.push(i)
  if (!keep.length) throw new Error('不能删掉全部页面')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, keep.map((p) => p - 1))
  copied.forEach((page, idx) => {
    const pageNo = keep[idx]
    const delta = opts.rotate?.[pageNo] ?? 0
    if (delta) {
      const angle = (((page.getRotation().angle + delta) % 360) + 360) % 360
      page.setRotation(degrees(angle))
    }
    out.addPage(page)
  })
  return out.save()
}

/** 把一批 PNG 印章贴进 PDF（视觉坐标，自动抵消页面旋转） */
export async function stampPngs(bytes: Uint8Array, stamps: Stamp[]): Promise<Uint8Array> {
  if (!stamps.length) return bytes
  const doc = await loadPdf(bytes)
  const cache = new Map<Uint8Array, PDFImage>()
  for (const s of stamps) {
    const page: PDFPage | undefined = doc.getPage(s.pageIndex)
    if (!page) throw new Error(`印章页码越界：第 ${s.pageIndex + 1} 页`)
    let img = cache.get(s.png)
    if (!img) {
      img = await doc.embedPng(s.png)
      cache.set(s.png, img)
    }
    const { width, height } = page.getSize()
    const info = makePageInfo(width, height, page.getRotation().angle)
    const d = visualRectToDraw(info, s.rect)
    page.drawImage(img, {
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
      rotate: degrees(d.rotate),
      opacity: s.opacity ?? 1,
    })
    await tick()
  }
  return doc.save()
}

/** 水印印章清单：同一枚 PNG 按位置铺到每一页 */
export function watermarkStamps(
  png: Uint8Array,
  imgW: number,
  imgH: number,
  pages: PageInfo[],
  opts: { position: 'tile' | 'center' | 'corners'; opacity: number; margin?: number },
): Stamp[] {
  const stamps: Stamp[] = []
  pages.forEach((info, pageIndex) => {
    const rects =
      opts.position === 'tile'
        ? tileRects(info.visW, info.visH, imgW, imgH)
        : opts.position === 'center'
          ? [centerRect(info.visW, info.visH, imgW, imgH)]
          : cornerRects(info.visW, info.visH, imgW, imgH, opts.margin ?? 18)
    for (const rect of rects) stamps.push({ pageIndex, png, rect, opacity: opts.opacity })
  })
  return stamps
}

/** 页码文案：`7` / `7 / 42` / `第 7 页` */
export type PageNumberFormat = 'n' | 'n/total' | 'cn'

export function pageNumberText(pageIndex: number, total: number, format: PageNumberFormat): string {
  const n = pageIndex + 1
  if (format === 'n/total') return `${n} / ${total}`
  if (format === 'cn') return `第 ${n} 页`
  return String(n)
}

/** 页码印章：每页文字不同，调用方逐页渲染 PNG 后用这个矩形贴 */
export function pageNumberStamp(
  pageIndex: number,
  info: PageInfo,
  png: Uint8Array,
  imgW: number,
  imgH: number,
  opts: { pos: PageNumberPos; margin?: number; opacity?: number },
): Stamp {
  return {
    pageIndex,
    png,
    rect: pageNumberRect(info.visW, info.visH, imgW, imgH, opts.pos, opts.margin ?? 20),
    opacity: opts.opacity ?? 0.85,
  }
}

/** 进 PDF 的单张图（字节 + 视觉像素尺寸） */
export interface PdfImageInput {
  bytes: Uint8Array
  kind: 'jpeg' | 'png'
  width: number
  height: number
}

/** 多张图 → 单个 PDF：一页一图，版式见 imagePageLayout */
export async function imagesToPdf(
  images: PdfImageInput[],
  opts: { size: ImagePageSize; margin: number },
): Promise<Uint8Array> {
  if (!images.length) throw new Error('请先选择图片')
  const doc = await PDFDocument.create()
  for (const img of images) {
    const embedded = img.kind === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes)
    const layout = imagePageLayout(img.width, img.height, opts)
    const page = doc.addPage([layout.pageW, layout.pageH])
    const d = visualRectToDraw(
      makePageInfo(layout.pageW, layout.pageH, 0),
      layout.rect,
    )
    page.drawImage(embedded, { x: d.x, y: d.y, width: d.width, height: d.height })
    await tick()
  }
  return doc.save()
}

/** 取整份文档的页面信息（水印铺页用） */
export async function pdfPageInfos(bytes: Uint8Array): Promise<PageInfo[]> {
  return pageInfos(await loadPdf(bytes))
}
