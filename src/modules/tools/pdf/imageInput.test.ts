import { describe, expect, it } from 'vitest'
import { readJpegOrientation } from './imageInput'

/** 拼一段带 EXIF Orientation 的最小 JPEG（APP1 + TIFF IFD0 单条目） */
function jpegWithOrientation(orientation: number, bigEndian = false): Uint8Array {
  const tiff: number[] = []
  const be = bigEndian
  const u16 = (n: number) => (be ? [(n >> 8) & 0xff, n & 0xff] : [n & 0xff, (n >> 8) & 0xff])
  const u32 = (n: number) =>
    be ? [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] : [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
  tiff.push(...(be ? [0x4d, 0x4d] : [0x49, 0x49])) // MM / II
  tiff.push(...u16(42))
  tiff.push(...u32(8)) // IFD0 偏移
  tiff.push(...u16(1)) // 1 条目
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), ...u16(0))
  tiff.push(...u32(0)) // 无下一 IFD

  const app1Data = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff] // "Exif\0\0" + TIFF
  const segLen = 2 + app1Data.length
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff,
    ...app1Data,
    0xff, 0xd9, // EOI
  ])
}

describe('readJpegOrientation', () => {
  it('读出 EXIF Orientation（小端 / 大端）', () => {
    expect(readJpegOrientation(jpegWithOrientation(6))).toBe(6)
    expect(readJpegOrientation(jpegWithOrientation(3))).toBe(3)
    expect(readJpegOrientation(jpegWithOrientation(8, true))).toBe(8)
    expect(readJpegOrientation(jpegWithOrientation(1))).toBe(1)
  })

  it('跳过前置的其他段（COM）也能找到 APP1', () => {
    const com = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63])
    const tail = jpegWithOrientation(6).slice(2)
    const merged = new Uint8Array([...com, ...tail])
    expect(readJpegOrientation(merged)).toBe(6)
  })

  it('没有 EXIF / 不是 JPEG → 0', () => {
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(0)
    expect(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(0)
    expect(readJpegOrientation(new Uint8Array([]))).toBe(0)
  })

  it('越界的 IFD 偏移不炸、返回 0', () => {
    const bad = jpegWithOrientation(6)
    // 结构：SOI(2) + APP1 段头(2+2) + "Exif\0\0"(6) + TIFF；IFD 偏移在 TIFF+4
    const idx = 2 + 2 + 2 + 6 + 4
    bad[idx] = 0x7f
    expect(readJpegOrientation(bad)).toBe(0)
  })
})
