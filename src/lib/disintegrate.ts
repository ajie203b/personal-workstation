import { prefersReducedMotion } from './motion'

/**
 * 碎沙删除（ui-motion「碎沙删除」）：把被删卡片按沙粒网格打散。
 * - 卡片克隆留在原位，按从左到右的扫光被擦掉（0.8s）
 * - 每粒沙从自己的位置往左上方飘，带随机抖动，各自淡出（约 1s）
 * - 数据删除照常立即执行，列表其余卡片由 FLIP 补位
 */

interface RGB {
  r: number
  g: number
  b: number
}

interface Grain {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  delay: number
  span: number
  phase: number
  color: string
}

export interface DisintegrateOptions {
  /** 元素被手势平移过时，把克隆和沙粒放回未平移的位置 */
  offsetX?: number
}

const SWEEP_MS = 780
const GRAIN_LIFE = 1.05
const MAX_GRAINS = 1400

function parseColor(raw: string, fallback: RGB): RGB {
  const value = raw.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const s = hex[1]
    const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (rgb) {
    const n = rgb[1].split(/[ ,/]+/).map(Number)
    if (n.length >= 3 && n.slice(0, 3).every(Number.isFinite)) {
      // 完全透明（如 rgba(0,0,0,0)）不能当颜色用
      if (n.length >= 4 && n[3] === 0) return fallback
      return { r: n[0], g: n[1], b: n[2] }
    }
  }
  return fallback
}

function cssColor(name: string, fallback: string): RGB {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  return parseColor(value, parseColor(fallback, { r: 128, g: 128, b: 128 }))
}

function mix(a: RGB, b: RGB, t: number): string {
  const f = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `rgb(${f(a.r, b.r)}, ${f(a.g, b.g)}, ${f(a.b, b.b)})`
}

/** 从卡片自身取一套沙色：主底色 + 文字墨色 + 主色/暖色点缀 */
function paletteFor(source: HTMLElement): string[] {
  const cs = getComputedStyle(source)
  const surface = cssColor('--surface', '#ffffff')
  const bg = parseColor(cs.backgroundColor, surface)
  const ink = parseColor(cs.color, cssColor('--on-surface', '#252b36'))
  const primary = cssColor('--primary', '#2c55b8')
  const warm = cssColor('--p1', '#a96916')
  return [
    mix(bg, ink, 0.1),
    mix(bg, ink, 0.26),
    mix(bg, primary, 0.28),
    mix(bg, warm, 0.42),
    mix(bg, ink, 0.56),
  ]
}

/**
 * 播放碎沙并返回是否真的播了（减弱动效时返回 false，调用方照常直接删除）。
 */
export function disintegrate(source: HTMLElement | null | undefined, options: DisintegrateOptions = {}): boolean {
  if (typeof document === 'undefined' || !source) return false
  if (prefersReducedMotion()) return false

  const rect = source.getBoundingClientRect()
  if (!rect.width || !rect.height) return false

  const offsetX = options.offsetX ?? 0
  const left = rect.left + offsetX
  const top = rect.top

  // 1. 原位留一张卡片快照，扫光从左往右擦除
  const clone = source.cloneNode(true) as HTMLElement
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  clone.querySelectorAll('[data-flip-id]').forEach((el) => el.removeAttribute('data-flip-id'))
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  clone.classList.add('sand-clone')
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    transform: 'none',
    transformOrigin: 'left top',
    pointerEvents: 'none',
    zIndex: '72',
    clipPath: 'inset(0 0 0 0)',
    transition: `clip-path ${SWEEP_MS}ms cubic-bezier(.33, 0, .25, 1)`,
  })
  document.body.appendChild(clone)
  // 先落一帧初始值再加过渡，否则浏览器会把两帧合并成「直接消失」
  void clone.offsetWidth
  clone.style.clipPath = 'inset(0 0 0 100%)'

  // 2. 沙粒画布：尺寸跟卡片走，坐标用卡片内相对值
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const canvas = document.createElement('canvas')
  canvas.className = 'sand-layer'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '73',
  })
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  document.body.appendChild(canvas)

  let maybeCtx: CanvasRenderingContext2D | null = null
  try {
    maybeCtx = canvas.getContext('2d')
  } catch {
    maybeCtx = null
  }
  if (!maybeCtx) {
    clone.remove()
    canvas.remove()
    return false
  }
  const ctx = maybeCtx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const colors = paletteFor(source)
  const step = Math.max(4, Math.sqrt((rect.width * rect.height) / 1250))
  const cols = Math.max(1, Math.floor(rect.width / step))
  const rows = Math.max(1, Math.floor(rect.height / step))
  const cellW = rect.width / cols
  const cellH = rect.height / rows
  const grains: Grain[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (Math.random() < 0.08) continue
      const x = col * cellW + Math.random() * cellW
      const y = row * cellH + Math.random() * cellH
      grains.push({
        x,
        y,
        // 往左上方飘；越靠近右边的沙越晚出发，和扫光同步
        vx: -24 - Math.random() * 62,
        vy: -34 - Math.random() * 76,
        size: 1.1 + Math.random() * 1.5,
        delay: (x / rect.width) * 0.72 + Math.random() * 0.09,
        span: GRAIN_LIFE * (0.82 + Math.random() * 0.36),
        phase: Math.random() * Math.PI * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
      })
      if (grains.length >= MAX_GRAINS) break
    }
    if (grains.length >= MAX_GRAINS) break
  }

  const started = performance.now()
  let raf = 0
  const cleanup = () => {
    cancelAnimationFrame(raf)
    canvas.remove()
    clone.remove()
    document.removeEventListener('visibilitychange', stop)
  }

  // 页面切走时别把 rAF 留在后台
  const stop = () => {
    if (document.hidden) cleanup()
  }

  const paint = (ts: number) => {
    const t = (ts - started) / 1000
    ctx.clearRect(0, 0, rect.width, rect.height)

    for (const g of grains) {
      const age = t - g.delay
      if (age < 0 || age > g.span) continue
      const alpha = Math.max(0, 1 - age / g.span)
      const px = g.x + g.vx * age + Math.sin(age * 9 + g.phase) * 2.4 * age
      const py = g.y + g.vy * age - 9 * age * age
      ctx.globalAlpha = alpha * 0.92
      ctx.fillStyle = g.color
      ctx.fillRect(px, py, g.size, g.size)
    }
    ctx.globalAlpha = 1

    const end = SWEEP_MS / 1000 + GRAIN_LIFE * 1.2
    if (t >= end) {
      cleanup()
      return
    }
    raf = requestAnimationFrame(paint)
  }

  document.addEventListener('visibilitychange', stop)
  raf = requestAnimationFrame(paint)

  // 扫光结束就收起快照，后面只留飘散的沙粒
  window.setTimeout(() => clone.remove(), SWEEP_MS + 40)

  return true
}
