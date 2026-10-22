import { describe, expect, it } from 'vitest'
import {
  buildQrOptions,
  matrixToImageData,
  qrSafeColor,
  relativeLuminance,
  shadeHex,
  toQrByteString,
  type QrModuleMatrix,
  type QrStyle,
} from './qrGen'

const baseStyle: QrStyle = {
  dotType: 'square',
  eyeType: 'square',
  eyeDotType: 'square',
  gradient: false,
  color: '#2C55B8',
  gradientColor: '',
  logo: null,
}

describe('toQrByteString', () => {
  it('纯 ASCII 原样（一个字符即一个字节）', () => {
    expect(toQrByteString('https://example.com/123')).toBe('https://example.com/123')
    expect(toQrByteString('')).toBe('')
  })
  it('中文转成 UTF-8 字节的二进制串', () => {
    // 「中」U+4E2D → UTF-8 E4 B8 AD
    expect(toQrByteString('中')).toBe('\u00e4\u00b8\u00ad')
    const s = toQrByteString('测试')
    expect(s).toHaveLength(6)
    for (const ch of s) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0xff)
  })
})

describe('buildQrOptions', () => {
  it('不加 Logo：容错 M，不带 image', () => {
    const o = buildQrOptions('hello', baseStyle, 280)
    expect(o.qrOptions?.errorCorrectionLevel).toBe('M')
    expect(o.image).toBeUndefined()
    expect(o.data).toBe('hello')
  })

  it('加 Logo：强制容错 H，Logo 面积不超过 20%', () => {
    const o = buildQrOptions('hello', { ...baseStyle, logo: 'data:image/png;base64,xxxx' }, 280)
    expect(o.qrOptions?.errorCorrectionLevel).toBe('H')
    expect(o.image).toBe('data:image/png;base64,xxxx')
    // imageSize 是边长占比：0.2 的边长 → 面积 4%；即便按面积口径读也 ≤ 20%
    expect(o.imageOptions?.imageSize ?? 0).toBeLessThanOrEqual(0.2)
    expect(o.imageOptions?.hideBackgroundDots).toBe(true)
  })

  it('渐变开：两点渐变，首尾色一致', () => {
    const o = buildQrOptions('hello', { ...baseStyle, gradient: true }, 280)
    const g = o.dotsOptions?.gradient
    expect(g?.type).toBe('linear')
    expect(g?.colorStops).toHaveLength(2)
    expect(g?.colorStops?.[0]?.color).toBe('#2C55B8')
    // 终点色自动派生，不等于起点
    expect(g?.colorStops?.[1]?.color).not.toBe('#2C55B8')
  })

  it('内容经 UTF-8 预编码后进 data', () => {
    const o = buildQrOptions('中文', baseStyle, 280)
    expect(o.data).toBe(toQrByteString('中文'))
    expect(o.data).not.toBe('中文')
  })
})

describe('颜色工具', () => {
  it('relativeLuminance：黑白极值', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('不是颜色')).toBe(0)
  })

  it('qrSafeColor：深色原样，浅色压暗到可扫亮度', () => {
    expect(qrSafeColor('#2C55B8')).toBe('#2C55B8')
    const darkened = qrSafeColor('#9FB6E8') // 深色主题的浅蓝
    expect(relativeLuminance(darkened)).toBeLessThanOrEqual(0.36)
    // 保色相：仍是蓝色系（蓝通道不小于红绿）
    const [r, g, b] = hexToRgb(darkened)
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThanOrEqual(g)
    // 非 hex 原样返回，交给自检兜底
    expect(qrSafeColor('rgb(1 2 3)')).toBe('rgb(1 2 3)')
  })

  it('shadeHex 提亮 / 压暗', () => {
    expect(shadeHex('#000000', 1)).toBe('#ffffff')
    expect(shadeHex('#ffffff', -1)).toBe('#000000')
    expect(shadeHex('#2C55B8', 0)).toBe('#2c55b8')
  })
})

describe('matrixToImageData', () => {
  it('尺寸含静区，静区留白、模块落点正确', () => {
    // 2×2 矩阵：只有左上角是黑
    const matrix: QrModuleMatrix = {
      getModuleCount: () => 2,
      isDark: (r, c) => r === 0 && c === 0,
    }
    const img = matrixToImageData(matrix, 2, 4)
    expect(img.width).toBe((2 + 8) * 2)
    expect(img.height).toBe(img.width)
    expect(pixel(img, 0, 0)).toEqual([255, 255, 255, 255]) // 静区角
    expect(pixel(img, 8, 8)).toEqual([0, 0, 0, 255]) // (0,0) 模块
    expect(pixel(img, 10, 8)).toEqual([255, 255, 255, 255]) // (0,1) 模块留白
    expect(pixel(img, 8, 10)).toEqual([255, 255, 255, 255]) // (1,0) 模块留白
  })
})

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function pixel(img: { data: Uint8ClampedArray; width: number }, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}
