/**
 * 画布指针手势状态机（纯逻辑，不碰 DOM，可单测）。
 *
 * 规则：
 * - 按 pointerId 跟踪所有活动指针；
 * - 单根手指 / 笔 / 鼠标左键 → 书写（drawing）；
 * - 任何时刻出现第二根手指 → 进入滚动（panning），进行中的手指笔画必须结束：
 *   落笔不久或还很短的笔画丢弃（多半是第二指落下前的误触），已经写了一段的笔画保留已画部分；
 * - 用过触控笔后，单根手指也只用来滚动（防手掌误触）；笔正在书写时手指一律忽略；
 * - 任一 pointerup / pointercancel / lostpointercapture 都把该指针移出；
 *   书写指针离开 → 结束书写（cancel 时丢弃）；所有指针都离开 → 状态完全复位。
 */

export type PointerKind = 'touch' | 'pen' | 'mouse'
export type GestureMode = 'idle' | 'drawing' | 'panning'

export interface PointerInput {
  id: number
  kind: PointerKind
  x: number
  y: number
  /** 时间戳（毫秒） */
  t: number
  /** 鼠标按键；非鼠标传 0 */
  button?: number
  /** 接触面特别大的触点（手掌） */
  palm?: boolean
}

/** 书写被打断时怎么处理已画部分 */
export type StrokeEnd = 'commit' | 'discard'

export type DownResult =
  | { action: 'ignore' }
  | { action: 'draw' }
  /** 进入滚动；interrupted 非空表示有进行中的笔画被打断，按 end 处理 */
  | { action: 'pan'; centerY: number; interrupted: { pointerId: number; end: StrokeEnd } | null }

export type UpResult =
  | { action: 'none' }
  /** 书写指针离开：commit 正常收笔，discard 丢弃（pointercancel / 失去捕获） */
  | { action: 'endDraw'; pointerId: number; end: StrokeEnd }
  /** 滚动中有手指离开但还有手指在：以新中心为基准继续滚动 */
  | { action: 'panRebase'; centerY: number }
  | { action: 'endPan' }

/** 第二指落下时，书写已超过这么久且画了这么长，就保留已画部分 */
export const KEEP_STROKE_MS = 250
export const KEEP_STROKE_LEN = 24

export class PointerGesture {
  private active = new Map<number, { kind: PointerKind; x: number; y: number }>()
  private _mode: GestureMode = 'idle'
  private drawId: number | null = null
  private drawStart = 0
  private drawLen = 0
  private lastDraw: { x: number; y: number } | null = null
  /** 用过触控笔后，手指只用来滚动 */
  penSeen = false

  get mode(): GestureMode {
    return this._mode
  }
  get drawingPointer(): number | null {
    return this.drawId
  }
  get activeCount(): number {
    return this.active.size
  }
  isDrawing(id: number): boolean {
    return this._mode === 'drawing' && this.drawId === id
  }
  isPanning(): boolean {
    return this._mode === 'panning'
  }

  private touchCenterY(): number {
    const ys = [...this.active.values()].filter((p) => p.kind === 'touch').map((p) => p.y)
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0
  }

  private touchCount(): number {
    let n = 0
    for (const p of this.active.values()) if (p.kind === 'touch') n++
    return n
  }

  private resetDraw() {
    this.drawId = null
    this.drawLen = 0
    this.lastDraw = null
  }

  down(p: PointerInput): DownResult {
    if (p.kind === 'pen') this.penSeen = true
    if (p.kind === 'touch') {
      if (p.palm) return { action: 'ignore' }
      // 笔正在写：手指（多半是手掌边缘）一律忽略，但仍跟踪，抬起时能正确移除
      if (this._mode === 'drawing' && this.drawId != null && this.active.get(this.drawId)?.kind === 'pen') {
        this.active.set(p.id, { kind: 'touch', x: p.x, y: p.y })
        return { action: 'ignore' }
      }
      this.active.set(p.id, { kind: 'touch', x: p.x, y: p.y })
      if (this.touchCount() >= 2 || this.penSeen) {
        let interrupted: { pointerId: number; end: StrokeEnd } | null = null
        if (this._mode === 'drawing' && this.drawId != null) {
          const keep = p.t - this.drawStart >= KEEP_STROKE_MS && this.drawLen >= KEEP_STROKE_LEN
          interrupted = { pointerId: this.drawId, end: keep ? 'commit' : 'discard' }
          this.resetDraw()
        }
        this._mode = 'panning'
        return { action: 'pan', centerY: this.touchCenterY(), interrupted }
      }
    } else {
      if (p.kind === 'mouse' && (p.button ?? 0) !== 0) return { action: 'ignore' }
      // 笔 / 鼠标在滚动途中不打断滚动
      if (this._mode === 'panning') return { action: 'ignore' }
      this.active.set(p.id, { kind: p.kind, x: p.x, y: p.y })
    }
    if (this._mode !== 'idle') {
      // 已在书写（另一根指针）时忽略新的书写指针
      return { action: 'ignore' }
    }
    this._mode = 'drawing'
    this.drawId = p.id
    this.drawStart = p.t
    this.drawLen = 0
    this.lastDraw = { x: p.x, y: p.y }
    return { action: 'draw' }
  }

  /** 返回滚动中的触点中心 y（用于平移）；书写指针只累计路径长度 */
  move(id: number, x: number, y: number): { panCenterY: number } | null {
    const cur = this.active.get(id)
    if (!cur) return null
    cur.x = x
    cur.y = y
    if (this._mode === 'panning' && cur.kind === 'touch') return { panCenterY: this.touchCenterY() }
    if (this._mode === 'drawing' && this.drawId === id && this.lastDraw) {
      this.drawLen += Math.hypot(x - this.lastDraw.x, y - this.lastDraw.y)
      this.lastDraw = { x, y }
    }
    return null
  }

  /** pointerup（cancelled=false）/ pointercancel、lostpointercapture（cancelled=true） */
  up(id: number, cancelled = false): UpResult {
    const had = this.active.delete(id)
    let result: UpResult = { action: 'none' }
    if (this._mode === 'drawing' && this.drawId === id) {
      this.resetDraw()
      this._mode = 'idle'
      result = { action: 'endDraw', pointerId: id, end: cancelled ? 'discard' : 'commit' }
    } else if (this._mode === 'panning' && had) {
      if (this.touchCount() === 0) {
        this._mode = 'idle'
        result = { action: 'endPan' }
      } else {
        result = { action: 'panRebase', centerY: this.touchCenterY() }
      }
    }
    // 所有指针都离开：彻底复位（防止残留状态卡死画布）
    if (this.active.size === 0) {
      this._mode = 'idle'
      this.resetDraw()
    }
    return result
  }

  reset(): void {
    this.active.clear()
    this._mode = 'idle'
    this.resetDraw()
  }
}
