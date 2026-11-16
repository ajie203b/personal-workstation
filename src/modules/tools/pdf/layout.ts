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

function fitTileAxis(avail: number, tileSize: number, prefGap: number, minGap: number, minCount: number) {
  const countAtPref = Math.floor((avail + tileSize * (prefGap - 1)) / Math.max(1e-6, tileSize * prefGap))
  const g = countAtPref >= minCount
    ? prefGap
    : minCount > 1
      ? Math.min(prefGap, Math.max(minGap, 1 + (avail / tileSize - minCount) / (minCount - 1)))
      : prefGap
  const step = Math.max(1e-6, tileSize * g)
  const space = step - tileSize
  const count = Math.max(minCount, Math.floor((avail + space + 1e-6) / step))
  const grid = count * tileSize + (count - 1) * space
  return { count, step, start: (avail - grid) / 2 }
}

/** 平铺水印：自适应间距与缩放，横屏/旋转页也尽量铺满 >=2×2 网格且整枚留于页内 */
export function tileRects(visW: number, visH: number, imgW: number, imgH: number, gap = 1.6): VisualRect[] {
  if (visW <= 0 || visH <= 0 || imgW <= 0 || imgH <= 0) return []
  const prefGap = Math.max(1.15, gap)
  const minGap = Math.min(prefGap, 1.22)
  const minCols = visW >= 40 ? 2 : 1
  const minRows = visH >= 40 ? 2 : 1
  const maxTileW = visW / (minCols + (minCols - 1) * (minGap - 1))
  const maxTileH = visH / (minRows + (minRows - 1) * (minGap - 1))
  const scale = Math.min(1, maxTileW / imgW, maxTileH / imgH)
  const w = imgW * scale
  const h = imgH * scale
  const xAxis = fitTileAxis(visW, w, prefGap, minGap, minCols)
  const yAxis = fitTileAxis(visH, h, prefGap, minGap, minRows)
  const out: VisualRect[] = []
  for (let r = 0; r < yAxis.count; r++) {
    for (let c = 0; c < xAxis.count; c++) {
      out.push({ x: xAxis.start + c * xAxis.step, y: yAxis.start + r * yAxis.step, w, h })
    }
  }
  return out
}

/** 居中单枚（超宽/超高时等比缩进留白边距内，避免边缘裁切） */
export function centerRect(visW: number, visH: number, imgW: number, imgH: number, margin = 18): VisualRect {
  const safeMargin = Math.min(margin, visW * 0.1, visH * 0.1)
  const maxW = Math.max(1, visW - safeMargin * 2)
  const maxH = Math.max(1, visH - safeMargin * 2)
  const scale = imgW > 0 && imgH > 0 ? Math.min(1, maxW / imgW, maxH / imgH) : 1
  const w = imgW * scale
  const h = imgH * scale
  return { x: (visW - w) / 2, y: (visH - h) / 2, w, h }
}

/** 四角各一枚（超宽图等比缩小以免左右/上下角相撞） */
export function cornerRects(visW: number, visH: number, imgW: number, imgH: number, margin = 18): VisualRect[] {
  const maxW = Math.max(1, (visW - margin * 3) / 2)
  const maxH = Math.max(1, (visH - margin * 3) / 2)
  const scale = imgW > 0 && imgH > 0 ? Math.min(1, maxW / imgW, maxH / imgH) : 1
  const w = imgW * scale
  const h = imgH * scale
  return [
    { x: margin, y: margin, w, h },
    { x: visW - margin - w, y: margin, w, h },
    { x: margin, y: visH - margin - h, w, h },
    { x: visW - margin - w, y: visH - margin - h, w, h },
  ]
}

/** 90°/270° 旋转缩略图放进指定宽高比容器时的安全缩放比，防止斜角被 overflow-hidden 裁掉 */
export function thumbRotScale(imgW: number, imgH: number, rot: number, boxRatio = 3 / 4): number {
  if (((rot % 180) + 180) % 180 === 0 || imgW <= 0 || imgH <= 0 || boxRatio <= 0) return 1
  const fitScale = Math.min(boxRatio / imgW, 1 / imgH)
  const drawW = imgW * fitScale
  const drawH = imgH * fitScale
  return Math.min(boxRatio / drawH, 1 / drawW) * 0.94
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
