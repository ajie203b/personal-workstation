/**
 * 笔迹几何（纯函数，可单测）：包围盒、算式块聚类、尾部等号检测、答案落点、橡皮命中。
 *
 * 聚类思路：每笔先是一组，组与组的包围盒「横向间隙 ≤ 1.2 字高 且 纵向间隙 ≤ 0.45 字高」
 * 就合并，反复合并到稳定。这样：
 * - 横写的一行（字与字间隔小）聚成一块，上下两行（行距 > 半个字高）分开；
 * - 分数线上下、上下标、根号盖住的内容都会并进同一块；
 * - 竖写（一列从上往下写好几个独立算式）每个算式自成一块；
 *   竖式（列竖式加减）笔画挨得近，会整体成一块交给识别模型。
 * 字高取全页笔画尺寸的中位数，避免受个别长横线（分数线、等号）影响。
 */
import type { Box, InkBlock, InkPoint, Stroke } from './types'

export const EMPTY_BOX: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

export function strokeBox(s: Pick<Stroke, 'points'>): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of s.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export const boxW = (b: Box) => b.maxX - b.minX
export const boxH = (b: Box) => b.maxY - b.minY

/** 两个盒子的横向 / 纵向间隙（重叠时为 0） */
export function boxGaps(a: Box, b: Box): { gx: number; gy: number } {
  return {
    gx: Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX)),
    gy: Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY)),
  }
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * 估计「字高」：只看「不扁」的笔画（高 ≥ 0.5×宽，排除减号、等号、分数线这类横线），
 * 取它们高度的中位数，再取 70 分位兜一下（加号的竖笔、小写字母比数字矮）。
 * 全是横线时退回 0.6×宽。结果夹在 [16, 240]。
 */
export function estimateCharHeight(strokes: Pick<Stroke, 'points'>[], fallback = 40): number {
  if (!strokes.length) return fallback
  const boxes = strokes.map(strokeBox)
  const tall = boxes.filter((b) => boxH(b) >= 0.5 * boxW(b)).map(boxH)
  let h: number
  if (tall.length) {
    const sorted = [...tall].sort((x, y) => x - y)
    h = Math.max(median(tall), sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.7))])
  } else {
    h = median(boxes.map((b) => boxW(b) * 0.6))
  }
  return Math.min(240, Math.max(16, h))
}

export interface ClusterOptions {
  /** 字高；不传则按笔画估计 */
  charHeight?: number
  /** 横向合并阈值（× 字高） */
  gapX?: number
  /** 纵向合并阈值（× 字高） */
  gapY?: number
}

/** 把笔画聚成独立算式块；块按阅读顺序（先上后下、同一行从左到右）返回 */
export function clusterStrokes(strokes: Stroke[], opts: ClusterOptions = {}): InkBlock[] {
  const live = strokes.filter((s) => s.points.length > 0)
  if (!live.length) return []
  const h = opts.charHeight ?? estimateCharHeight(live)
  const tx = (opts.gapX ?? 1.2) * h
  const ty = (opts.gapY ?? 0.45) * h

  let groups = live.map((s) => ({ ids: [s.id], box: strokeBox(s) }))
  let merged = true
  while (merged) {
    merged = false
    const next: typeof groups = []
    for (const g of groups) {
      let target = -1
      for (let i = 0; i < next.length; i++) {
        const { gx, gy } = boxGaps(next[i].box, g.box)
        if (gx <= tx && gy <= ty) {
          target = i
          break
        }
      }
      if (target < 0) next.push({ ids: [...g.ids], box: { ...g.box } })
      else {
        next[target].ids.push(...g.ids)
        next[target].box = unionBox(next[target].box, g.box)
        merged = true
      }
    }
    groups = next
  }

  const blocks: InkBlock[] = groups.map((g) => {
    const ids = [...g.ids].sort()
    return { key: ids.join('|'), strokeIds: ids, box: g.box }
  })
  // 阅读顺序：纵向中心差小于半个字高视为同一行，行内按 x
  blocks.sort((a, b) => {
    const ca = (a.box.minY + a.box.maxY) / 2
    const cb = (b.box.minY + b.box.maxY) / 2
    if (Math.abs(ca - cb) > h * 0.5) return ca - cb
    return a.box.minX - b.box.minX
  })
  return blocks
}

export interface EqualsMark {
  /** 等号两笔的合并包围盒 */
  box: Box
  /** 两笔的纵向中线 */
  midY: number
}

/** 看起来像一条短横线：宽明显大于高 */
function isFlat(b: Box, h: number): boolean {
  const w = boxW(b)
  const ht = boxH(b)
  return w >= 0.22 * h && ht <= 0.4 * h && w >= ht * 2.2
}

/**
 * 检测块的「尾部等号」：两条近似等长、上下平行、横向大部分重叠的短横线，
 * 且它们是整块最右边的东西（右侧没有别的笔画）。
 * 只看几何，不依赖模型，所以写完「=」立刻就能触发识别。
 */
export function detectTrailingEquals(strokes: Stroke[], charHeight: number): EqualsMark | null {
  if (strokes.length < 2) return null
  const items = strokes.map((s) => ({ s, b: strokeBox(s) }))
  const flats = items.filter((it) => isFlat(it.b, charHeight))
  let best: EqualsMark | null = null
  for (let i = 0; i < flats.length; i++) {
    for (let j = i + 1; j < flats.length; j++) {
      const a = flats[i].b
      const b = flats[j].b
      const wa = boxW(a)
      const wb = boxW(b)
      const ratio = wa / wb
      if (ratio < 0.45 || ratio > 2.2) continue
      const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
      if (overlap < 0.55 * Math.min(wa, wb)) continue
      const dy = Math.abs((a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2)
      if (dy < 0.08 * charHeight || dy > 0.75 * charHeight) continue
      const box = unionBox(a, b)
      const cx = (box.minX + box.maxX) / 2
      // 右侧不能还有别的笔画（等号必须在最后）
      const others = items.filter((it) => it.s !== flats[i].s && it.s !== flats[j].s)
      if (others.some((it) => (it.b.minX + it.b.maxX) / 2 > cx)) continue
      // 等号左边得有东西，否则只是两条横线
      if (!others.some((it) => it.b.maxX <= box.minX + 0.3 * boxW(box))) continue
      // 等号上下不能有笔画盖住（排除「分数线 + 减号」之类）
      const covered = others.some((it) => {
        const ov = Math.min(it.b.maxX, box.maxX) - Math.max(it.b.minX, box.minX)
        return ov > 0.5 * boxW(box)
      })
      if (covered) continue
      const mark = { box, midY: (box.minY + box.maxY) / 2 }
      if (!best || mark.box.maxX > best.box.maxX) best = mark
    }
  }
  return best
}

export interface AnswerAnchor {
  /** 答案左边缘 x */
  x: number
  /** 答案纵向中心 y */
  y: number
  /** 建议字号（CSS 像素） */
  fontSize: number
  /** inline：写在等号后面；below：写在块下方 */
  placement: 'inline' | 'below'
}

/** 答案落点：有尾部等号就紧贴等号右侧、与等号中线对齐；否则放在块的左下方 */
export function answerAnchor(block: InkBlock, equals: EqualsMark | null, charHeight: number): AnswerAnchor {
  const fontSize = Math.round(Math.min(96, Math.max(18, charHeight * 0.95)))
  if (equals) {
    return { x: equals.box.maxX + charHeight * 0.3, y: equals.midY, fontSize, placement: 'inline' }
  }
  return {
    x: block.box.minX,
    y: block.box.maxY + charHeight * 0.35 + fontSize * 0.5,
    fontSize: Math.round(fontSize * 0.75),
    placement: 'below',
  }
}

export interface FitOptions {
  /** 答案（含 ≈ 近似值）渲染后的宽度，CSS 像素；未测量时用 estimateAnswerWidth 估算 */
  answerWidth: number
  /** 画布可视宽度 */
  viewWidth: number
  /** 离右 / 左边界的留白 */
  margin?: number
}

export interface FittedAnswer extends AnswerAnchor {
  /** 本应写在等号后，但右侧放不下，改到了算式下方 */
  wrapped: boolean
  /** 答案比整个可视宽度还宽时，答案元素自身要限宽并允许横向滚动（单位 CSS 像素） */
  maxWidth?: number
}

/**
 * 按可用宽度摆放答案，保证完全落在可视范围内（画布容器会裁掉溢出部分）：
 * - 等号右侧放得下 → 照旧写在等号后；
 * - 放不下 → 换到算式下方，与算式左对齐；若仍超出右边界则整体左移贴住右边界（不越过左边界）；
 * - 比可视宽度还宽 → 贴左边界，并给出 maxWidth 让答案自身横向滚动。
 * 字号保持不变，方便沿用已测得的宽度。
 */
export function fitAnswer(block: InkBlock, equals: EqualsMark | null, charHeight: number, opts: FitOptions): FittedAnswer {
  const margin = opts.margin ?? 8
  const base = answerAnchor(block, equals, charHeight)
  const right = opts.viewWidth - margin
  const w = Math.max(0, opts.answerWidth)
  // 视口宽度未知（还没布局）时不做调整
  if (!(opts.viewWidth > 0)) return { ...base, wrapped: false }
  if (base.placement === 'inline' && base.x + w <= right) return { ...base, wrapped: false }
  const wrapped = base.placement === 'inline'
  const fontSize = base.fontSize
  const y = wrapped ? block.box.maxY + charHeight * 0.35 + fontSize * 0.5 : base.y
  const avail = right - margin
  if (w > avail) return { x: margin, y, fontSize, placement: 'below', wrapped, maxWidth: Math.max(0, avail) }
  const x = Math.max(margin, Math.min(block.box.minX, right - w))
  return { x, y, fontSize, placement: 'below', wrapped }
}

/** 渲染前的答案宽度粗估：字符数 × 字号 × 0.62（手写体偏宽），≈ 近似值按小字号另计 */
export function estimateAnswerWidth(text: string, fontSize: number, alt?: string): number {
  const main = Math.max(1, text.length) * fontSize * 0.62
  const altW = alt ? 8 + (alt.length + 2) * Math.max(13, fontSize * 0.5) * 0.62 : 0
  return Math.ceil(main + altW)
}

/** 点到线段的距离 */
function distToSegment(px: number, py: number, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const x = a.x + t * dx
  const y = a.y + t * dy
  return Math.hypot(px - x, py - y)
}

/** 橡皮：返回被 (x,y)、半径 r 擦到的笔画 id（整笔删除，和苹果备忘录一致） */
export function strokesHitBy(strokes: Stroke[], x: number, y: number, r: number): string[] {
  const hit: string[] = []
  for (const s of strokes) {
    const b = strokeBox(s)
    if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) continue
    const pts = s.points
    if (pts.length === 1) {
      if (Math.hypot(pts[0].x - x, pts[0].y - y) <= r) hit.push(s.id)
      continue
    }
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(x, y, pts[i - 1], pts[i]) <= r + s.width / 2) {
        hit.push(s.id)
        break
      }
    }
  }
  return hit
}

/**
 * 输入平滑：丢掉离上一个点太近的采样，再做一次轻量指数平滑（压感也平滑），
 * 抖动明显减少但不会让快速笔画「拖尾」。
 */
export function smoothAppend(points: InkPoint[], next: InkPoint, minDist = 0.8, follow = 0.75): boolean {
  const last = points[points.length - 1]
  if (!last) {
    points.push(next)
    return true
  }
  if (Math.hypot(next.x - last.x, next.y - last.y) < minDist) return false
  points.push({
    x: last.x + (next.x - last.x) * follow,
    y: last.y + (next.y - last.y) * follow,
    p: last.p * 0.4 + next.p * 0.6,
    t: next.t,
  })
  return true
}

/** 笔宽随压感变化：0.6×~1.4× */
export function pressureWidth(base: number, p: number): number {
  return base * (0.6 + 0.8 * Math.max(0, Math.min(1, p)))
}
