/**
 * 裁剪框计算（v3.3）：人脸关键点 → 证件照裁剪矩形，纯函数可单测。
 *
 * 思路（人像证件照的通用构图）：
 * - 用两眼间距 d 推出「眼→下巴」≈ d × 1.0、「眼→头顶」≈ d × 1.15（正面人像的
 *   经验比例，FaceDetector 只给 6 个关键点没有下巴，只能推算；有下巴关键点时直接用）。
 * - 头高 = 头顶→下巴，令它占输出照片高的 headRatio（规格参数，默认 0.7），
 *   头顶以上留 headroom（默认 0.1）→ 定出与规格同比例的裁剪框。
 * - 最后 fitAndClamp 保证矩形完整落在图内（缩到图内、再平移夹边）。
 */

/** 关键点（图像像素坐标） */
export interface Landmark {
  x: number
  y: number
}

/** 人脸关键点集合：两眼必填，其余可选（能提供就用更准的） */
export interface FacePoints {
  /** 左眼（人物自己的左眼，其实左右对调不影响中点与间距） */
  leftEye: Landmark
  rightEye: Landmark
  /** 下巴；没有就用眼睛推算 */
  chin?: Landmark
  /** 头顶；没有就用眼睛推算 */
  top?: Landmark
}

export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

export interface CropParams {
  /** 头顶到下巴占裁剪框高度的比例 */
  headRatio: number
  /** 头顶留白占裁剪框高度的比例 */
  headroom: number
  /** 手动微调：框中心偏移（占框宽/高的比例，-0.5~0.5） */
  offsetX: number
  offsetY: number
  /** 手动缩放：1 = 自动，>1 放大取景框（人变小） */
  zoom: number
}

export const DEFAULT_CROP_PARAMS: CropParams = {
  headRatio: 0.7,
  headroom: 0.1,
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
}

/** 眼→下巴 / 眼距（正面人像经验比例，脸长的人可手动微调） */
export const EYE_TO_CHIN_RATIO = 1.0
/** 眼→头顶（发际线以上）/ 眼距 */
export const EYE_TO_TOP_RATIO = 1.15

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 矩形收进图内：先整体缩小到能放下（保比例），再平移夹到 [0, 图宽/高]。
 * 图比框还小的极端情况退化成整图，不会出现负宽高。
 */
export function fitAndClamp(box: CropBox, imgW: number, imgH: number): CropBox {
  let { x, y, width, height } = box
  if (width <= 0 || height <= 0 || imgW <= 0 || imgH <= 0) {
    return { x: 0, y: 0, width: Math.max(1, imgW), height: Math.max(1, imgH) }
  }
  const scale = Math.min(1, imgW / width, imgH / height)
  if (scale < 1) {
    width *= scale
    height *= scale
    x += (box.width - width) / 2
    y += (box.height - height) / 2
  }
  x = clamp(x, 0, imgW - width)
  y = clamp(y, 0, imgH - height)
  return { x, y, width, height }
}

/**
 * 关键点 → 裁剪框。
 *
 * @param points  人脸关键点（像素坐标）
 * @param imgW    图宽
 * @param imgH    图高
 * @param aspect  输出宽/高比（如 295/413）
 * @param params  头高占比、头顶留白、手动偏移/缩放
 */
export function computeCropBox(
  points: FacePoints,
  imgW: number,
  imgH: number,
  aspect: number,
  params: Partial<CropParams> = {},
): CropBox {
  const p = { ...DEFAULT_CROP_PARAMS, ...params }
  const midX = (points.leftEye.x + points.rightEye.x) / 2
  const eyeY = (points.leftEye.y + points.rightEye.y) / 2
  const d = Math.hypot(
    points.rightEye.x - points.leftEye.x,
    points.rightEye.y - points.leftEye.y,
  )

  const chinY = points.chin ? points.chin.y : eyeY + d * EYE_TO_CHIN_RATIO
  const topY = points.top ? points.top.y : eyeY - d * EYE_TO_TOP_RATIO
  const headH = Math.max(1, chinY - topY)

  // 头高占 headRatio → 裁剪框高；宽按规格比例
  let boxH = headH / clamp(p.headRatio, 0.05, 1)
  let boxW = boxH * aspect

  // 手动缩放：以框中心为基准放大取景框
  boxW *= clamp(p.zoom, 0.5, 2)
  boxH *= clamp(p.zoom, 0.5, 2)

  // 头顶留白 + 手动偏移
  const headroomPx = boxH * clamp(p.headroom, -0.5, 0.5)
  let x = midX - boxW / 2 + p.offsetX * boxW
  let y = topY - headroomPx + p.offsetY * boxH

  // 数值不合法（NaN/负图）时兜底成整图，别把 NaN 传给 canvas
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(boxW) || !Number.isFinite(boxH)) {
    return fallbackCropBox(imgW, imgH, aspect)
  }
  x = Math.round(x * 100) / 100
  y = Math.round(y * 100) / 100
  return fitAndClamp({ x, y, width: boxW, height: boxH }, imgW, imgH)
}

/** 没检测到人脸时的默认框：图中央按比例取最大内接框 */
export function fallbackCropBox(imgW: number, imgH: number, aspect: number): CropBox {
  let width = imgW
  let height = width / aspect
  if (height > imgH) {
    height = imgH
    width = height * aspect
  }
  return fitAndClamp({ x: (imgW - width) / 2, y: (imgH - height) / 2, width, height }, imgW, imgH)
}

/** 证件照辅助线（三等分 + 眼线），给预览画布用 */
export interface CropGuides {
  /** 眼睛应处的高度（框内比例约 0.42） */
  eyeLineY: number
  /** 三等分横线 */
  thirdLinesY: [number, number]
}

export function cropGuides(box: CropBox): CropGuides {
  return {
    eyeLineY: box.y + box.height * 0.42,
    thirdLinesY: [box.y + box.height / 3, box.y + (box.height * 2) / 3],
  }
}

/**
 * MediaPipe FaceDetector 关键点（归一化 0~1，顺序：右眼、左眼、鼻尖、嘴中、
 * 右耳屏、左耳屏）→ 像素坐标 FacePoints。
 * 嘴中（index 3）存在时用它精修下巴：嘴→下巴 ≈ 0.6 × 眼→嘴。
 */
export function facePointsFromNormalized(
  keypoints: Array<{ x: number; y: number }>,
  imgW: number,
  imgH: number,
): FacePoints {
  const px = (p: { x: number; y: number }): Landmark => ({ x: p.x * imgW, y: p.y * imgH })
  const leftEye = px(keypoints[1] ?? keypoints[0])
  const rightEye = px(keypoints[0] ?? keypoints[1])
  const points: FacePoints = { leftEye, rightEye }
  const mouth = keypoints[3]
  if (mouth) {
    const m = px(mouth)
    const eyeY = (leftEye.y + rightEye.y) / 2
    points.chin = { x: m.x, y: m.y + (m.y - eyeY) * 0.6 }
  }
  return points
}
