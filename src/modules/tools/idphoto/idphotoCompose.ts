/**
 * 合成与导出（v3.3）：裁剪 + 换底 → 规格尺寸证件照；再排版到 6 寸相纸 / 单页 PDF。
 * 全部走 canvas / pdf-lib，本地完成，照片不出本机。
 */
import { PDFDocument } from 'pdf-lib'
import type { PhotoSpec } from './idphotoSpec'
import type { CropBox } from './idphotoCrop'
import { SHEET_6IN, computeSheetLayout, cutLines, type SheetSpec } from './idphotoLayout'

export interface ComposeInput {
  /** 去溢出后的 RGBA（工作图） */
  cleaned: Uint8ClampedArray
  /** 0~1 alpha（与 cleaned 同尺寸） */
  alpha: Float32Array
  width: number
  height: number
  /** 裁剪框（工作图坐标） */
  crop: CropBox
  /** 底色（CSS 颜色） */
  bg: string
}

/**
 * 裁剪区 → 底色上的证件照画布（规格尺寸）。
 * 先把裁剪区抠成带 alpha 的小画布，再整体缩放到规格尺寸（裁剪框比例 = 规格比例，正好铺满）。
 */
export function composePhotoCanvas(input: ComposeInput, spec: PhotoSpec): HTMLCanvasElement {
  const cropW = Math.max(1, Math.round(input.crop.width))
  const cropH = Math.max(1, Math.round(input.crop.height))
  const x0 = Math.round(input.crop.x)
  const y0 = Math.round(input.crop.y)

  // 1. 裁剪区抠像（RGB 取去溢出后的像素，A 取羽化 alpha）
  const cut = document.createElement('canvas')
  cut.width = cropW
  cut.height = cropH
  const cutCtx = cut.getContext('2d')
  if (!cutCtx) throw new Error('画布创建失败')
  const img = cutCtx.createImageData(cropW, cropH)
  // 裁剪框可以超出原图（滑杆放大/平移时，v3.3.3）：图外像素 alpha=0，合成时露底色
  for (let y = 0; y < cropH; y++) {
    const ry = y0 + y
    const sy = Math.min(input.height - 1, Math.max(0, ry))
    for (let x = 0; x < cropW; x++) {
      const rx = x0 + x
      const dst = (y * cropW + x) * 4
      if (rx < 0 || ry < 0 || rx >= input.width || ry >= input.height) {
        img.data[dst + 3] = 0
        continue
      }
      const sx = Math.min(input.width - 1, Math.max(0, rx))
      const src = (sy * input.width + sx) * 4
      img.data[dst] = input.cleaned[src]
      img.data[dst + 1] = input.cleaned[src + 1]
      img.data[dst + 2] = input.cleaned[src + 2]
      img.data[dst + 3] = Math.round(
        Math.min(1, Math.max(0, input.alpha[sy * input.width + sx])) * 255,
      )
    }
  }
  cutCtx.putImageData(img, 0, 0)

  // 2. 底色 + 抠像缩放铺满（bg === 'transparent' 时跳过 fillRect 保持透明通道）
  const out = document.createElement('canvas')
  out.width = spec.width
  out.height = spec.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('画布创建失败')
  if (input.bg !== 'transparent') {
    ctx.fillStyle = input.bg
    ctx.fillRect(0, 0, out.width, out.height)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cut, 0, 0, out.width, out.height)
  return out
}

/** 相纸排版画布：白底、照片 1:1 排列、浅灰裁切细边框 + 四角裁切线 */
export function composeSheetCanvas(
  photo: HTMLCanvasElement,
  spec: PhotoSpec,
  sheetSpec: SheetSpec = SHEET_6IN,
  count = spec.sheetCount,
): HTMLCanvasElement {
  const layout = computeSheetLayout({ width: spec.width, height: spec.height }, sheetSpec, count)
  const sheet = document.createElement('canvas')
  sheet.width = sheetSpec.width
  sheet.height = sheetSpec.height
  const ctx = sheet.getContext('2d')
  if (!ctx) throw new Error('画布创建失败')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  for (const cell of layout.cells) {
    ctx.drawImage(photo, cell.x, cell.y, cell.width, cell.height)
    // 白底/浅底照片在白相纸上需 1px 浅灰裁切细线才能看清边界
    ctx.strokeStyle = '#CBD5E1'
    ctx.lineWidth = 1
    ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1)
  }
  // 裁切线：细灰线，压在格子外沿
  ctx.strokeStyle = '#999999'
  ctx.lineWidth = 1
  for (const l of cutLines(layout)) {
    ctx.beginPath()
    ctx.moveTo(l.x1 + 0.5, l.y1 + 0.5)
    ctx.lineTo(l.x2 + 0.5, l.y2 + 0.5)
    ctx.stroke()
  }
  return sheet
}

/** canvas → JPEG 字节 */
export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('JPEG 编码失败'))
          return
        }
        resolve(new Uint8Array(await blob.arrayBuffer()))
      },
      'image/jpeg',
      quality,
    )
  })
}

/**
 * 排版单页 PDF：按相纸英寸尺寸生成（72pt/in），embedJpg 铺满。
 * 冲印店/打印店常要 PDF，一张一页免得再裁。
 */
export async function composeSheetPdf(jpgBytes: Uint8Array, sheetSpec: SheetSpec = SHEET_6IN): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([(sheetSpec.width / sheetSpec.dpi) * 72, (sheetSpec.height / sheetSpec.dpi) * 72])
  const jpg = await pdf.embedJpg(jpgBytes)
  page.drawImage(jpg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
  return pdf.save()
}

/** 规格文件名：证件照_一寸_295x413.jpg */
export function photoFilename(spec: PhotoSpec, ext: string): string {
  return `证件照_${spec.name}_${spec.width}x${spec.height}.${ext}`
}
