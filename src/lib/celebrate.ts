import { prefersReducedMotion } from './motion'

/**
 * 完成任务撒花（ui-motion「撒花庆祝」）：从触发点向上喷出扇形彩纸，
 * 带重力、水平阻尼与翻面，约 2.5 秒自然落尽。
 * 全页共用一个固定 canvas，粒子只在有任务时启动 rAF，结束后自动停。
 */

type Shape = 'strip' | 'dot' | 'square'

interface Confetti {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  rot: number
  vr: number
  front: string
  back: string
  shape: Shape
  born: number
  life: number
  phase: number
}

/** 五组主题色，前后两面：翻过去时用更暗的一面，像纸片翻背 */
const COLORS: ReadonlyArray<readonly [string, string]> = [
  ['#3B82F6', '#1E4FA8'],
  ['#22A06B', '#146B47'],
  ['#F0B451', '#A97718'],
  ['#E5484D', '#98242A'],
  ['#8B5CF6', '#5B32B8'],
]

const COUNT = 100
const GRAVITY = 520
const DRAG_X = 1.4
const DRAG_Y = 0.9
const FADE_TAIL = 0.62

let layer: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let particles: Confetti[] = []
let raf = 0
let last = 0
let viewW = 0
let viewH = 0

function ensureLayer(): boolean {
  if (layer) return true
  if (typeof document === 'undefined') return false
  const c = document.createElement('canvas')
  c.className = 'confetti-layer'
  c.setAttribute('aria-hidden', 'true')
  document.body.appendChild(c)
  try {
    ctx = c.getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) {
    c.remove()
    return false
  }
  layer = c
  viewW = 0
  viewH = 0
  return true
}

function syncSize(): void {
  if (!layer || !ctx) return
  const w = window.innerWidth
  const h = window.innerHeight
  if (w === viewW && h === viewH) return
  viewW = w
  viewH = h
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  layer.width = Math.round(w * dpr)
  layer.height = Math.round(h * dpr)
  layer.style.width = `${w}px`
  layer.style.height = `${h}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function frame(ts: number): void {
  if (!ctx) return
  const dt = Math.min(0.05, Math.max(0.001, (ts - last) / 1000))
  last = ts
  syncSize()

  ctx.clearRect(0, 0, viewW, viewH)
  const alive: Confetti[] = []

  for (const p of particles) {
    const age = (ts - p.born) / 1000
    if (age >= p.life) continue

    // 重力 + 空气阻力：先快后慢，落下来时带一点横向摆动
    p.vy += GRAVITY * dt
    p.vx *= Math.max(0, 1 - DRAG_X * dt)
    p.vy *= Math.max(0, 1 - DRAG_Y * dt)
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.rot += p.vr * dt

    const flip = Math.cos(p.phase + age * 6)
    const sy = Math.abs(flip) < 0.08 ? 0.08 : flip
    const tail = p.life - age
    const alpha = tail < FADE_TAIL ? tail / FADE_TAIL : 1

    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    ctx.scale(1, sy)
    ctx.globalAlpha = alpha
    ctx.fillStyle = flip < 0 ? p.back : p.front
    if (p.shape === 'dot') {
      ctx.beginPath()
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
    }
    ctx.restore()
    alive.push(p)
  }

  particles = alive
  if (particles.length === 0) {
    ctx.clearRect(0, 0, viewW, viewH)
    raf = 0
    // 播完就释放整屏 canvas 的显存，下次撒花再建
    layer?.remove()
    layer = null
    ctx = null
    viewW = 0
    viewH = 0
    return
  }
  raf = requestAnimationFrame(frame)
}

/** 从视口坐标 (x, y) 向上喷出一束彩纸 */
export function burstConfetti(x: number, y: number, count = COUNT): void {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  if (!ensureLayer()) return
  syncSize()

  const now = performance.now()
  for (let i = 0; i < count; i++) {
    // 扇形：以正上方为中心 ±35°，速度随机
    const angle = (-90 + (Math.random() * 2 - 1) * 35) * (Math.PI / 180)
    const speed = 340 + Math.random() * 430
    const shape: Shape = i % 3 === 0 ? 'strip' : i % 3 === 1 ? 'dot' : 'square'
    const [front, back] = COLORS[i % COLORS.length]
    const w = shape === 'strip' ? 9 + Math.random() * 5 : shape === 'dot' ? 3 + Math.random() * 2 : 4 + Math.random() * 2.5
    const h = shape === 'strip' ? 3 + Math.random() * 1.8 : w

    particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w,
      h,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() * 2 - 1) * 11,
      front,
      back,
      shape,
      born: now,
      // 寿命用秒：约 2.5 秒落尽，最后 0.6 秒各自淡出
      life: 1.9 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
    })
  }

  if (!raf) {
    last = now
    raf = requestAnimationFrame(frame)
  }
}

/** 从任务卡片上的勾选圈位置撒花；找不到元素时退到屏幕中下方 */
export function burstFromTask(taskId: string): void {
  if (typeof document === 'undefined') return
  const card = document.getElementById(`task-${taskId}`)
  const trigger = card?.querySelector<HTMLElement>('[data-check-circle]') ?? card
  const rect = trigger?.getBoundingClientRect()
  if (rect && rect.width > 0) {
    burstConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return
  }
  burstConfetti(window.innerWidth / 2, window.innerHeight * 0.62)
}
