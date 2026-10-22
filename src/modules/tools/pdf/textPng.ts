/**
 * 文字 → 透明 PNG（PDF 工具箱水印 / 页码用）。
 *
 * 关键取舍：**不给 PDF 嵌中文字体**——完整 CJK 字体动辄几 MB，会让每份产物都膨胀。
 * 改为用系统字体在 canvas 上把文字画成透明 PNG，再把 PNG 贴进 PDF（pdfOps.stampPngs）。
 * 产物里只有一张小图，中文、emoji 都能显示，代价是文字不可选中（水印场景无所谓）。
 */

export interface TextPng {
  bytes: Uint8Array
  width: number
  height: number
}

export interface TextPngOptions {
  /** 字号（px，贴进 PDF 时 1px = 1pt） */
  fontSize?: number
  /** 旋转角度（度，逆时针）；已烘进 PNG，贴的时候就不用再转 */
  angle?: number
  /** 文字颜色（canvas fillStyle），默认深灰 */
  color?: string
  /** 四周留白（px），免得斜字被裁 */
  padding?: number
  /** 粗体（水印默认粗） */
  bold?: boolean
}

/** 文字渲染成透明 PNG（浏览器 canvas；测试请勿在 node 里调） */
export async function renderTextPng(text: string, opts: TextPngOptions = {}): Promise<TextPng> {
  const fontSize = opts.fontSize ?? 32
  const angle = ((opts.angle ?? 0) * Math.PI) / 180
  const padding = opts.padding ?? Math.ceil(fontSize * 0.35)
  const font = `${opts.bold === false ? '' : 'bold '}${fontSize}px system-ui, sans-serif`

  // 先量文字盒
  const measure = document.createElement('canvas')
  const mctx = measure.getContext('2d')
  if (!mctx) throw new Error('当前环境不支持 canvas，无法生成水印')
  mctx.font = font
  const metrics = mctx.measureText(text)
  const textW = Math.max(1, Math.ceil(metrics.width))
  const textH = Math.max(1, Math.ceil((metrics.actualBoundingBoxAscent ?? fontSize * 0.8) + (metrics.actualBoundingBoxDescent ?? fontSize * 0.2)))

  // 旋转后的包围盒：斜 45° 时宽高都会变大，按旋转后的范围开画布
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const boxW = Math.ceil(textW * cos + textH * sin) + padding * 2
  const boxH = Math.ceil(textW * sin + textH * cos) + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = boxW
  canvas.height = boxH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 canvas，无法生成水印')
  ctx.translate(boxW / 2, boxH / 2)
  ctx.rotate(-angle) // 视觉上「逆时针」旋转（canvas y 向下，取负）
  ctx.font = font
  ctx.fillStyle = opts.color ?? 'rgba(60, 60, 60, 1)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('水印图片导出失败')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: boxW, height: boxH }
}
