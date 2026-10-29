/**
 * 压缩与 JPEG 头测试：KB 二分（mock toBlob 编码器）、JFIF APP0 的 DPI 写入/读回校验。
 */
import { describe, expect, it } from 'vitest'
import {
  applyJpegDpi,
  compressJpegToKb,
  readJpegDpi,
  setJpegDpi,
  type JpegEncoder,
} from './idphotoCompress'

/**
 * mock 编码器：体积 = 基准 × 质量系数 × 像素比，单调递增，
 * 用来验证二分方向与缩尺寸策略，不真跑 canvas。
 */
function mockEncoder(baseBytes: number, refW = 295, refH = 413): JpegEncoder {
  return async (quality, width, height) => {
    const size = Math.round(baseBytes * (quality / 0.8) * ((width * height) / (refW * refH)))
    return new Blob([new Uint8Array(size)])
  }
}

describe('compressJpegToKb', () => {
  it.each([41, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 94])(
    '质量上限落在 %i 时应结束搜索并返回最佳质量',
    async (limit) => {
      let calls = 0
      const encode: JpegEncoder = async (quality) => {
        if (++calls > 20) throw new Error('压缩质量搜索未收敛')
        return new Blob([new Uint8Array(Math.round(quality * 100) <= limit ? 10 * 1024 : 21 * 1024)])
      }
      const result = await compressJpegToKb(encode, { minKb: 5, maxKb: 20, width: 295, height: 413 })
      expect(result.quality).toBe(limit / 100)
      expect(result.bytes).toBeLessThanOrEqual(20 * 1024)
      expect(calls).toBeLessThanOrEqual(20)
    },
  )

  it('二分出 [minKb, maxKb] 内的体积与对应质量', async () => {
    // 0.8 质量 = 16KB → 上限 20KB / 下限 5KB，质量会提到接近上限
    const res = await compressJpegToKb(mockEncoder(16 * 1024), {
      minKb: 5,
      maxKb: 20,
      width: 295,
      height: 413,
    })
    expect(res.bytes).toBeLessThanOrEqual(20 * 1024)
    expect(res.bytes).toBeGreaterThanOrEqual(5 * 1024)
    expect(res.quality).toBeGreaterThanOrEqual(0.4)
    expect(res.quality).toBeLessThanOrEqual(0.95)
    expect(res.shrinks).toBe(0)
    expect(res.width).toBe(295)
  })

  it('质量到下限仍超 maxKb → 缩尺寸再来', async () => {
    // 0.4 质量就 100KB，上限 20KB：必须缩尺寸
    const res = await compressJpegToKb(mockEncoder(200 * 1024), {
      minKb: 5,
      maxKb: 20,
      width: 295,
      height: 413,
    })
    expect(res.shrinks).toBeGreaterThan(0)
    expect(res.width).toBeLessThan(295)
    expect(res.height).toBeLessThan(413)
    expect(res.bytes).toBeLessThanOrEqual(20 * 1024)
  })

  it('低于下限会提高质量（0.8 基准太小 → 顶到 0.95）', async () => {
    // 0.8 质量才 2KB，远低于下限 5KB → 质量拉满也进不了下限，但应返回最高质量
    const res = await compressJpegToKb(mockEncoder(2 * 1024), {
      minKb: 5,
      maxKb: 20,
      width: 295,
      height: 413,
    })
    expect(res.quality).toBe(0.95)
    expect(res.bytes).toBeLessThanOrEqual(20 * 1024)
  })

  it('编码器被调用多次（真二分），尺寸不变时只调质量', async () => {
    let calls = 0
    const enc: JpegEncoder = async (quality, width, height) => {
      calls++
      return mockEncoder(16 * 1024)(quality, width, height)
    }
    await compressJpegToKb(enc, { minKb: 5, maxKb: 20, width: 295, height: 413 })
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(calls).toBeLessThan(20) // 二分 6~7 次 + 首尾，不该爆炸
  })

  it('结果 blob 就是编码器产物（不动字节）', async () => {
    const res = await compressJpegToKb(mockEncoder(16 * 1024), {
      minKb: 5,
      maxKb: 20,
      width: 295,
      height: 413,
    })
    expect(res.blob.size).toBe(res.bytes)
  })
})

// ---------- JFIF DPI ----------

/** 构造最小 JPEG：SOI +（可选 JFIF APP0）+ EOI */
function makeJpeg(withJfif: boolean, dpiX = 72, dpiY = 72): Uint8Array {
  const head = [0xff, 0xd8]
  const app0 = withJfif
    ? [
        0xff, 0xe0, 0x00, 0x10,
        0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
        0x01, 0x01, // version 1.1
        0x01, // units = dpi
        (dpiX >> 8) & 0xff, dpiX & 0xff,
        (dpiY >> 8) & 0xff, dpiY & 0xff,
        0x00, 0x00,
      ]
    : []
  const tail = [0xff, 0xd9]
  return Uint8Array.from([...head, ...app0, ...tail])
}

describe('setJpegDpi / readJpegDpi', () => {
  it('已有 JFIF 段：改写密度并读回一致', () => {
    const jpeg = makeJpeg(true, 72, 72)
    const patched = setJpegDpi(jpeg, 300)
    const dpi = readJpegDpi(patched)
    expect(dpi).toEqual({ dpiX: 300, dpiY: 300, units: 1 })
  })

  it('X/Y 可分开设置', () => {
    const patched = setJpegDpi(makeJpeg(true), 200, 300)
    const dpi = readJpegDpi(patched)
    expect(dpi?.dpiX).toBe(200)
    expect(dpi?.dpiY).toBe(300)
  })

  it('没有 JFIF 段：SOI 后插入一段，字节变长 18', () => {
    const jpeg = makeJpeg(false)
    const patched = setJpegDpi(jpeg, 300)
    expect(patched.length).toBe(jpeg.length + 18)
    expect(readJpegDpi(patched)).toEqual({ dpiX: 300, dpiY: 300, units: 1 })
  })

  it('不改入参字节', () => {
    const jpeg = makeJpeg(true, 72, 72)
    const before = Array.from(jpeg)
    setJpegDpi(jpeg, 300)
    expect(Array.from(jpeg)).toEqual(before)
    expect(readJpegDpi(jpeg)?.dpiX).toBe(72)
  })

  it('DPI 出界时 clamp 到 1~65535', () => {
    const hi = readJpegDpi(setJpegDpi(makeJpeg(true), 99999))
    expect(hi?.dpiX).toBe(65535)
    const lo = readJpegDpi(setJpegDpi(makeJpeg(true), -5))
    expect(lo?.dpiX).toBe(1)
  })

  it('非法字节流：读回 null，改写也不崩', () => {
    expect(readJpegDpi(Uint8Array.from([1, 2, 3]))).toBeNull()
    const out = setJpegDpi(Uint8Array.from([1, 2, 3]), 300)
    expect(out.length).toBe(3) // 非 JPEG 原样返回（找不到 SOI 不插段）
  })
})

describe('applyJpegDpi', () => {
  it('blob 改写 DPI 后读回校验', async () => {
    const blob = new Blob([makeJpeg(true)], { type: 'image/jpeg' })
    const out = await applyJpegDpi(blob, 300)
    const bytes = new Uint8Array(await out.arrayBuffer())
    expect(readJpegDpi(bytes)).toEqual({ dpiX: 300, dpiY: 300, units: 1 })
  })
})
