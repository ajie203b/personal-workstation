import { describe, expect, it } from 'vitest'
import { PointerGesture, type PointerInput } from './pointerGesture'

const touch = (id: number, x: number, y: number, t: number): PointerInput => ({ id, kind: 'touch', x, y, t })

describe('PointerGesture（双指滚动后画布不卡死，回归）', () => {
  it('晚落第二指 → 滚动 → 两指抬起 → 再次单指可书写', () => {
    const g = new PointerGesture()
    expect(g.down(touch(1, 100, 100, 0))).toEqual({ action: 'draw' })
    // 第一指写了一段
    for (let i = 1; i <= 10; i++) g.move(1, 100 + i * 5, 100)
    // 600ms 后第二指才落下（超过旧逻辑的 250ms 窗口）
    const r = g.down(touch(2, 300, 200, 600))
    expect(r.action).toBe('pan')
    if (r.action === 'pan') {
      // 已经写了 50px、超过 250ms：保留已画部分，但书写状态必须结束
      expect(r.interrupted).toEqual({ pointerId: 1, end: 'commit' })
      expect(r.centerY).toBe(150)
    }
    expect(g.mode).toBe('panning')
    expect(g.drawingPointer).toBeNull()
    // 滚动
    expect(g.move(1, 150, 50)).toEqual({ panCenterY: 125 })
    // 两指先后抬起
    expect(g.up(1)).toEqual({ action: 'panRebase', centerY: 200 })
    expect(g.up(2)).toEqual({ action: 'endPan' })
    expect(g.mode).toBe('idle')
    expect(g.activeCount).toBe(0)
    // 再次单指落下：可以正常书写
    expect(g.down(touch(3, 50, 50, 2000))).toEqual({ action: 'draw' })
    expect(g.isDrawing(3)).toBe(true)
    expect(g.up(3)).toEqual({ action: 'endDraw', pointerId: 3, end: 'commit' })
    expect(g.mode).toBe('idle')
  })

  it('第二指很快落下：进行中的笔画丢弃', () => {
    const g = new PointerGesture()
    g.down(touch(1, 0, 0, 0))
    g.move(1, 3, 0)
    const r = g.down(touch(2, 100, 0, 120))
    expect(r).toMatchObject({ action: 'pan', interrupted: { pointerId: 1, end: 'discard' } })
  })

  it('超过 250ms 但几乎没移动（按住不动）也丢弃', () => {
    const g = new PointerGesture()
    g.down(touch(1, 0, 0, 0))
    g.move(1, 2, 2)
    expect(g.down(touch(2, 100, 0, 800))).toMatchObject({ interrupted: { end: 'discard' } })
  })

  it('pointercancel / lostpointercapture 结束书写并丢弃', () => {
    const g = new PointerGesture()
    g.down(touch(1, 0, 0, 0))
    expect(g.up(1, true)).toEqual({ action: 'endDraw', pointerId: 1, end: 'discard' })
    expect(g.mode).toBe('idle')
    expect(g.down(touch(2, 0, 0, 10))).toEqual({ action: 'draw' })
  })

  it('滚动中某指 cancel，另一指抬起后也完全复位', () => {
    const g = new PointerGesture()
    g.down(touch(1, 0, 0, 0))
    g.down(touch(2, 0, 100, 10))
    g.up(2, true)
    expect(g.mode).toBe('panning')
    g.up(1)
    expect(g.mode).toBe('idle')
    expect(g.down(touch(5, 0, 0, 100))).toEqual({ action: 'draw' })
  })

  it('同一指针重复 up（pointerup 后又 lostpointercapture）无副作用', () => {
    const g = new PointerGesture()
    g.down(touch(1, 0, 0, 0))
    g.up(1)
    expect(g.up(1, true)).toEqual({ action: 'none' })
    expect(g.down(touch(2, 0, 0, 10))).toEqual({ action: 'draw' })
  })

  it('三指：第三指落下只更新滚动中心；全部抬起后复位', () => {
    const g = new PointerGesture()
    g.down(touch(1, 0, 0, 0))
    g.down(touch(2, 0, 100, 10))
    expect(g.down(touch(3, 0, 200, 20))).toMatchObject({ action: 'pan', centerY: 100, interrupted: null })
    g.up(1)
    g.up(2)
    g.up(3)
    expect(g.mode).toBe('idle')
    expect(g.activeCount).toBe(0)
  })

  it('用过笔后单指滚动；笔书写时手指忽略且不影响收笔', () => {
    const g = new PointerGesture()
    expect(g.down({ id: 9, kind: 'pen', x: 0, y: 0, t: 0 })).toEqual({ action: 'draw' })
    expect(g.down(touch(1, 10, 10, 50))).toEqual({ action: 'ignore' })
    expect(g.isDrawing(9)).toBe(true)
    expect(g.up(9)).toEqual({ action: 'endDraw', pointerId: 9, end: 'commit' })
    g.up(1)
    expect(g.down(touch(2, 0, 0, 100))).toMatchObject({ action: 'pan' })
    expect(g.up(2)).toEqual({ action: 'endPan' })
    expect(g.down({ id: 10, kind: 'pen', x: 0, y: 0, t: 200 })).toEqual({ action: 'draw' })
  })

  it('手掌大触点、鼠标右键忽略', () => {
    const g = new PointerGesture()
    expect(g.down({ ...touch(1, 0, 0, 0), palm: true })).toEqual({ action: 'ignore' })
    expect(g.down({ id: 2, kind: 'mouse', x: 0, y: 0, t: 0, button: 2 })).toEqual({ action: 'ignore' })
    expect(g.down({ id: 3, kind: 'mouse', x: 0, y: 0, t: 0, button: 0 })).toEqual({ action: 'draw' })
  })

  it('双指平移同时跟踪横向中心 X 与纵向中心 Y，并可重置 penSeen 允许手指书写', () => {
    const g = new PointerGesture()
    g.down(touch(1, 100, 100, 0))
    g.down(touch(2, 200, 300, 10))
    expect(g.panCenter()).toEqual({ x: 150, y: 200 })
    g.move(1, 140, 120)
    expect(g.panCenter()).toEqual({ x: 170, y: 210 })
    g.up(1)
    g.up(2)

    g.down({ id: 9, kind: 'pen', x: 0, y: 0, t: 20 })
    g.up(9)
    expect(g.penSeen).toBe(true)
    expect(g.down(touch(3, 10, 10, 30))).toMatchObject({ action: 'pan' })
    g.up(3)
    g.penSeen = false
    expect(g.down(touch(4, 10, 10, 40))).toEqual({ action: 'draw' })
  })

  it('平板上手掌先贴屏进入触控平移时，触控笔落笔优先接管立即书写，并支持双指间距计算', () => {
    const g = new PointerGesture()
    g.down({ id: 9, kind: 'pen', x: 0, y: 0, t: 0 })
    g.up(9)
    // 手掌先贴屏触发触控平移
    expect(g.down(touch(1, 100, 100, 50))).toMatchObject({ action: 'pan' })
    expect(g.mode).toBe('panning')
    // 触控笔落笔时立即打断平移进入书写
    expect(g.down({ id: 10, kind: 'pen', x: 150, y: 150, t: 80 })).toEqual({ action: 'draw' })
    expect(g.isDrawing(10)).toBe(true)
    expect(g.up(10)).toEqual({ action: 'endDraw', pointerId: 10, end: 'commit' })
    g.up(1)

    // 双指距离计算（双指捏合缩放）
    g.down(touch(2, 0, 0, 200))
    g.down(touch(3, 30, 40, 210))
    expect(g.touchDistance()).toBeCloseTo(50, 5)
    g.up(2)
    g.up(3)
    expect(g.touchDistance()).toBeNull()
  })
})
