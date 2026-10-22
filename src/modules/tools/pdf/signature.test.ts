import { describe, expect, it } from 'vitest'
import {
  bytesToDataUrl,
  dataUrlToBytes,
  roundTripDataUrl,
  smoothStroke,
  velocityWidth,
} from './signature'
import { placementRect } from './layout'
import { makePng } from './testPng'

describe('smoothStroke（二次贝塞尔中点平滑）', () => {
  const p = (x: number, y: number, t: number) => ({ x, y, t })

  it('不足两点没有线段', () => {
    expect(smoothStroke([])).toEqual([])
    expect(smoothStroke([p(0, 0, 0)])).toEqual([])
  })

  it('两点一段折线；多点线段首尾相接', () => {
    const two = smoothStroke([p(0, 0, 0), p(10, 10, 10)])
    expect(two).toHaveLength(1)
    expect(two[0].from).toEqual({ x: 0, y: 0 })
    expect(two[0].to).toEqual({ x: 10, y: 10 })

    const many = smoothStroke([p(0, 0, 0), p(10, 0, 10), p(20, 10, 20), p(30, 10, 30)])
    expect(many).toHaveLength(3)
    for (let i = 0; i + 1 < many.length; i++) {
      expect(many[i].to).toEqual(many[i + 1].from)
    }
    // 中点作端点：第一段终点是 p1/p2 的中点
    expect(many[0].to).toEqual({ x: 15, y: 5 })
  })
})

describe('velocityWidth（速度变线宽）', () => {
  const a = { x: 0, y: 0, t: 0 }

  it('慢笔粗、快笔细，且夹在 [min, base] 内', () => {
    const slow = velocityWidth(a, { x: 1, y: 0, t: 100 }, 8, 2)
    const fast = velocityWidth(a, { x: 100, y: 0, t: 10 }, 8, 2)
    expect(slow).toBeGreaterThan(fast)
    expect(slow).toBeLessThanOrEqual(8)
    expect(fast).toBeGreaterThanOrEqual(2)
    // 荒谬速度也只细到 min
    expect(velocityWidth(a, { x: 100000, y: 0, t: 1 }, 8, 2)).toBe(2)
  })
})

describe('签名 PNG 数据往返', () => {
  it('dataURL ↔ 字节无损往返', () => {
    const png = makePng(3, 2, [10, 20, 30, 255])
    const dataUrl = bytesToDataUrl(png)
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const back = dataUrlToBytes(dataUrl)
    expect(Array.from(back)).toEqual(Array.from(png))
    expect(roundTripDataUrl(dataUrl)).toBe(dataUrl)
  })
})

describe('签名放置矩形', () => {
  it('中心点定位，按页宽比例定尺寸', () => {
    const r = placementRect(500, 700, 250, 125, { nx: 0.3, ny: 0.3, nw: 0.5 })
    expect(r.w).toBe(250)
    expect(r.h).toBe(125)
    expect(r.x).toBe(25)
    expect(r.y).toBe(147.5)
    // 点到角落时夹回页内
    const edge = placementRect(500, 700, 250, 125, { nx: 0, ny: 1, nw: 0.5 })
    expect(edge.x).toBe(0)
    expect(edge.y + edge.h).toBeLessThanOrEqual(700)
  })
})
