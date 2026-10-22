/**
 * 页面几何（PDF 工具箱）：视觉坐标 ↔ pdf-lib 画图参数。
 *
 * 两个坐标系：
 * - 视觉坐标：原点左上、x 向右、y 向下 —— 和阅读器 / 缩略图里看到的一致，
 *   用户点哪、水印放哪，全部记在视觉坐标里。
 * - pdf-lib 用户空间：原点左下、y 向上，且页面可能带 /Rotate（90/180/270），
 *   画上去的东西会被整个转过去。
 *
 * visualRectToDraw 把「视觉矩形」换算成 drawImage 的 x/y/width/height/rotate，
 * 保证贴上去的图在屏幕上是正的（抵消页面自身的旋转）。
 * 换算关系有单测按四角点对拍，别手改公式。
 */

export interface VisualRect {
  /** 视觉坐标 x（原点左上） */
  x: number
  y: number
  w: number
  h: number
}

/** drawImage 的落点：锚点是图片自身左下角，rotate 逆时针（PDF 约定） */
export interface DrawRect {
  x: number
  y: number
  width: number
  height: number
  /**度数：0 / 90 / 180 / 270 */
  rotate: number
}

/** 页面信息：媒体框尺寸 + 归一化旋转 + 视觉尺寸（旋转 90/270 时宽高互换） */
export interface PageInfo {
  mediaW: number
  mediaH: number
  rotation: 0 | 90 | 180 | 270
  visW: number
  visH: number
}

/** 把任意角度归一到 0/90/180/270（PDF 页旋转只允许这四档） */
export function normRotation(angle: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  return (r === 0 || r === 90 || r === 180 || r === 270 ? r : 0) as 0 | 90 | 180 | 270
}

/** 页面信息（mediaW/H 来自 page.getSize()，rotation 来自 page.getRotation().angle） */
export function pageInfo(mediaW: number, mediaH: number, angle: number): PageInfo {
  const rotation = normRotation(angle)
  const swapped = rotation === 90 || rotation === 270
  return {
    mediaW,
    mediaH,
    rotation,
    visW: swapped ? mediaH : mediaW,
    visH: swapped ? mediaW : mediaH,
  }
}

/**
 * 视觉矩形 → drawImage 参数。
 *
 * 各旋转下的锚点（rect 在视觉坐标，图片要摆正显示）：
 *   0°:   (x, H - y - h)          H=媒体高
 *   90°:  (y + h, x)              —— 页面显示顺时针转了 90°，画图时逆时针补 90°
 *   180°: (W - x, y + h)          W=媒体宽
 *   270°: (W - y - h, H - x)
 */
export function visualRectToDraw(info: PageInfo, rect: VisualRect): DrawRect {
  const { mediaW: W, mediaH: H, rotation } = info
  const { x, y, w, h } = rect
  switch (rotation) {
    case 90:
      return { x: y + h, y: x, width: w, height: h, rotate: 90 }
    case 180:
      return { x: W - x, y: y + h, width: w, height: h, rotate: 180 }
    case 270:
      return { x: W - y - h, y: H - x, width: w, height: h, rotate: 270 }
    default:
      return { x, y: H - y - h, width: w, height: h, rotate: 0 }
  }
}

/** 平铺水印：居中铺满的网格（整枚图留在页内），行间不错位 */
export function tileRects(visW: number, visH: number, imgW: number, imgH: number, gap = 1.8): VisualRect[] {
  const stepX = Math.max(1, imgW * gap)
  const stepY = Math.max(1, imgH * gap)
  const spaceX = stepX - imgW
  const spaceY = stepY - imgH
  // 图比页还大时至少留一枚（居中溢出，由调用方按需缩图）
  const cols = Math.max(1, Math.floor((visW + spaceX) / stepX))
  const rows = Math.max(1, Math.floor((visH + spaceY) / stepY))
  const gridW = cols * imgW + (cols - 1) * spaceX
  const gridH = rows * imgH + (rows - 1) * spaceY
  const startX = (visW - gridW) / 2
  const startY = (visH - gridH) / 2
  const out: VisualRect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: startX + c * stepX, y: startY + r * stepY, w: imgW, h: imgH })
    }
  }
  return out
}

/** 居中单枚（不缩放，图多大就多大） */
export function centerRect(visW: number, visH: number, imgW: number, imgH: number): VisualRect {
  return { x: (visW - imgW) / 2, y: (visH - imgH) / 2, w: imgW, h: imgH }
}

/** 四角各一枚 */
export function cornerRects(visW: number, visH: number, imgW: number, imgH: number, margin = 18): VisualRect[] {
  return [
    { x: margin, y: margin, w: imgW, h: imgH },
    { x: visW - margin - imgW, y: margin, w: imgW, h: imgH },
    { x: margin, y: visH - margin - imgH, w: imgW, h: imgH },
    { x: visW - margin - imgW, y: visH - margin - imgH, w: imgW, h: imgH },
  ]
}

/** 页码位置（底部一行） */
export type PageNumberPos = 'left' | 'center' | 'right'

/** 页码矩形：底部一行，left/center/right 三档 */
export function pageNumberRect(
  visW: number,
  visH: number,
  imgW: number,
  imgH: number,
  pos: PageNumberPos,
  margin = 20,
): VisualRect {
  const y = visH - margin - imgH
  const x = pos === 'left' ? margin : pos === 'right' ? visW - margin - imgW : (visW - imgW) / 2
  return { x, y, w: imgW, h: imgH }
}

/** 图片转 PDF 的三种版式（单位 pt，1pt = 1px@72dpi） */
export type ImagePageSize = 'a4' | 'native' | 'fit'

export const A4 = { w: 595.28, h: 841.89 }

export interface ImagePageLayout {
  pageW: number
  pageH: number
  /** 图片画在页面视觉矩形里（页面旋转恒 0，自己新建的页没有 /Rotate） */
  rect: VisualRect
}

/**
 * 单张图的版式：
 * - a4：固定 A4，图片等比缩放（可放大）居中，受边距约束
 * - native：页面 = 图片尺寸 + 四周边距，图不缩放
 * - fit：页宽固定 A4 宽，页高按图片宽高比自适应（长图不裁切）
 */
export function imagePageLayout(
  imgW: number,
  imgH: number,
  opts: { size: ImagePageSize; margin: number },
): ImagePageLayout {
  const m = Math.max(0, opts.margin)
  if (opts.size === 'native') {
    return {
      pageW: imgW + m * 2,
      pageH: imgH + m * 2,
      rect: { x: m, y: m, w: imgW, h: imgH },
    }
  }
  if (opts.size === 'fit') {
    const innerW = Math.max(1, A4.w - m * 2)
    const scale = innerW / imgW
    const drawH = imgH * scale
    return {
      pageW: A4.w,
      pageH: drawH + m * 2,
      rect: { x: m, y: m, w: innerW, h: drawH },
    }
  }
  const innerW = Math.max(1, A4.w - m * 2)
  const innerH = Math.max(1, A4.h - m * 2)
  const scale = Math.min(innerW / imgW, innerH / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  return {
    pageW: A4.w,
    pageH: A4.h,
    rect: { x: (A4.w - drawW) / 2, y: (A4.h - drawH) / 2, w: drawW, h: drawH },
  }
}

/**
 * 签名放置：归一化位置 → 视觉矩形。
 * nx/ny 是签名「中心」在页内的相对位置（点哪放哪），nw 是签名宽占页宽的比例；
 * 算出的矩形会夹回页内，保证整枚签名都在页面上。
 */
export function placementRect(
  visW: number,
  visH: number,
  sigW: number,
  sigH: number,
  p: { nx: number; ny: number; nw: number },
): VisualRect {
  const w = Math.min(visW, Math.max(8, p.nw * visW))
  const h = (w * sigH) / Math.max(1, sigW)
  return {
    x: Math.min(Math.max(0, p.nx * visW - w / 2), Math.max(0, visW - w)),
    y: Math.min(Math.max(0, p.ny * visH - h / 2), Math.max(0, visH - h)),
    w,
    h,
  }
}
