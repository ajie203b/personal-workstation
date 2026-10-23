/**
 * 人脸检测的多窗口搜索规划（v3.3.3），纯函数可单测。
 *
 * BlazeFace short-range 是给自拍设计的：输入固定 128×128，人脸要占画面相当比例才认得出。
 * 整张图直接送进去时，半身照 / 远一点的照片里人脸只有十几个像素 → 检不到。
 * 所以先整图试，再按「中上部、逐级缩小的正方形窗口」裁出来逐个试（证件照人脸基本在中上部），
 * 窗口内的归一化关键点再映射回整图坐标。
 */

export interface SearchWindow {
  x: number
  y: number
  size: number
}

/**
 * 生成搜索窗口：整图之后，窗口边长依次为短边的 1、0.6、0.36 倍，
 * 每级在图上按半窗步长平铺，优先中上部（按与 (0.5, 0.35) 的距离排序）。
 * 总数封顶 maxWindows，避免老手机上跑太久。
 */
export function planFaceSearchWindows(width: number, height: number, maxWindows = 24): SearchWindow[] {
  const short = Math.min(width, height)
  const out: SearchWindow[] = []
  for (const k of [1, 0.6, 0.36]) {
    const size = Math.max(64, Math.round(short * k))
    if (size > short) continue
    const step = Math.max(1, Math.round(size / 2))
    const level: SearchWindow[] = []
    for (let y = 0; ; y += step) {
      const yy = Math.min(y, height - size)
      for (let x = 0; ; x += step) {
        const xx = Math.min(x, width - size)
        level.push({ x: xx, y: yy, size })
        if (xx >= width - size) break
      }
      if (yy >= height - size) break
    }
    const fx = width * 0.5
    const fy = height * 0.35
    level.sort(
      (a, b) =>
        Math.hypot(a.x + a.size / 2 - fx, a.y + a.size / 2 - fy) -
        Math.hypot(b.x + b.size / 2 - fx, b.y + b.size / 2 - fy),
    )
    for (const w of level) {
      if (!out.some((o) => o.x === w.x && o.y === w.y && o.size === w.size)) out.push(w)
    }
  }
  return out.slice(0, maxWindows)
}

/** 窗口内的归一化关键点 → 整图归一化坐标 */
export function windowToImageNormalized(
  kp: { x: number; y: number },
  win: SearchWindow,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (win.x + kp.x * win.size) / width, y: (win.y + kp.y * win.size) / height }
}
