/**
 * alpha 后处理测试：羽化、去溢出（去白边）、背景色估计、alpha 上采样。
 */
import { describe, expect, it } from 'vitest'
import {
  estimateBackground,
  featherAlpha,
  removeColorSpill,
  resizeAlpha,
  resizeRgba,
} from './idphotoAlpha'

describe('featherAlpha', () => {
  it('半径 0 原样复制', () => {
    const src = Float32Array.from([0, 1, 0.5, 0.25])
    const out = featherAlpha(src, 2, 2, 0)
    expect(Array.from(out)).toEqual(Array.from(src))
    expect(out).not.toBe(src) // 不改入参
  })

  it('硬边被抹成渐变，边缘 clamp 保持端值', () => {
    // 1×5 的横条：左 1 右 0，羽化后中间过渡（边缘按 clamp 取样，端值保留）
    const src = Float32Array.from([1, 1, 1, 0, 0])
    const out = featherAlpha(src, 5, 1, 1)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[4]).toBeCloseTo(0, 6)
    expect(out[2]).toBeGreaterThan(0)
    expect(out[2]).toBeLessThan(1)
    // 单调不增
    for (let i = 1; i < 5; i++) expect(out[i]).toBeLessThanOrEqual(out[i - 1] + 1e-6)
  })

  it('全 1 的实心区域中心不变', () => {
    const src = new Float32Array(9).fill(1)
    const out = featherAlpha(src, 3, 3, 1)
    expect(out[4]).toBeCloseTo(1, 6)
  })
})

describe('estimateBackground', () => {
  it('取 alpha<0.1 像素的 RGB 均值', () => {
    // 2×2：两个全透明（背景红/蓝混）、两个实心
    const rgba = new Uint8ClampedArray([
      200, 0, 0, 255, // a=0 → 背景
      0, 0, 100, 255, // a=0 → 背景
      10, 20, 30, 255, // a=1 → 人
      40, 50, 60, 255, // a=0.5 → 边缘，不算背景
    ])
    const alpha = Float32Array.from([0, 0, 1, 0.5])
    const bg = estimateBackground(rgba, alpha, 2, 2)
    expect(bg[0]).toBeCloseTo(100, 5)
    expect(bg[1]).toBeCloseTo(0, 5)
    expect(bg[2]).toBeCloseTo(50, 5)
  })

  it('没有背景像素时退回白色', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 255])
    const alpha = Float32Array.from([1])
    expect(estimateBackground(rgba, alpha, 1, 1)).toEqual([255, 255, 255])
  })
})

describe('removeColorSpill', () => {
  it('半透明边缘按 c = a·f + (1-a)·bg 反解前景', () => {
    // a=0.5、背景白 255、混色 200 → f = (200 - 0.5×255)/0.5 = 145
    const rgba = new Uint8ClampedArray([200, 200, 200, 255])
    const alpha = Float32Array.from([0.5])
    const out = removeColorSpill(rgba, alpha, 1, 1, [255, 255, 255])
    expect(out[0]).toBeCloseTo(145, 4)
    expect(out[1]).toBeCloseTo(145, 4)
    expect(out[2]).toBeCloseTo(145, 4)
  })

  it('实心与全透明像素不动', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    const alpha = Float32Array.from([1, 0])
    const out = removeColorSpill(rgba, alpha, 2, 1, [255, 255, 255])
    expect(Array.from(out)).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  it('反解结果 clamp 在 0~255（低 alpha 高混色不溢出）', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255])
    const alpha = Float32Array.from([0.02])
    const out = removeColorSpill(rgba, alpha, 1, 1, [0, 0, 0])
    // f = 255/0.02 = 12750 → clamp 255
    expect(out[0]).toBe(255)
  })

  it('不改入参数组', () => {
    const rgba = new Uint8ClampedArray([200, 200, 200, 255])
    const alpha = Float32Array.from([0.5])
    removeColorSpill(rgba, alpha, 1, 1, [255, 255, 255])
    expect(rgba[0]).toBe(200)
  })
})

describe('resizeAlpha', () => {
  it('同尺寸恒等', () => {
    const src = Float32Array.from([0, 0.5, 1, 0.25])
    const out = resizeAlpha(src, 2, 2, 2, 2)
    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.25])
  })

  it('2×2 放大到 4×4：角点保持、中间插值', () => {
    const src = Float32Array.from([1, 0, 0, 1])
    const out = resizeAlpha(src, 2, 2, 4, 4)
    expect(out[0]).toBeCloseTo(1, 5) // 左上
    expect(out[3]).toBeCloseTo(0, 5) // 右上
    expect(out[12]).toBeCloseTo(0, 5) // 左下
    expect(out[15]).toBeCloseTo(1, 5) // 右下
    expect(out[5]).toBeGreaterThan(0)
    expect(out[5]).toBeLessThan(1)
  })
})

describe('resizeRgba', () => {
  it('同尺寸恒等（含 alpha 通道）', () => {
    const src = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8])
    const out = resizeRgba(src, 2, 1, 2, 1)
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('2×1 缩到 1×1 取四通道平均过渡', () => {
    const src = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255])
    const out = resizeRgba(src, 2, 1, 1, 1)
    expect(out[0]).toBeGreaterThan(10)
    expect(out[0]).toBeLessThan(20)
  })
})
