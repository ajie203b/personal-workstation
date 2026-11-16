import { afterEach, describe, expect, it, vi } from 'vitest'
import { inferImageMime, readJpegOrientation, renderBitmapToBytes } from './imageInput'

afterEach(() => { vi.unstubAllGlobals() })

describe('inferImageMime / renderBitmapToBytes', () => {
  it('file.type 为空时回退到文件名扩展名', () => {
    expect(inferImageMime({ type: '', name: 'scan.PNG' })).toBe('image/png')
    expect(inferImageMime({ type: '', name: 'photo.jpg' })).toBe('image/jpeg')
    expect(inferImageMime({ type: '', name: 'clip.webp' })).toBe('image/webp')
    expect(inferImageMime({ type: '', name: 'logo.svg' })).toBe('image/svg+xml')
    expect(inferImageMime({ type: 'image/gif', name: 'x.bin' })).toBe('image/gif')
  })

  it('非 PNG 转 JPEG 时先铺 #ffffff 白底再绘制，避免透明变黑；90° 旋转对换宽高', async () => {
    const calls: string[] = []
    const fakeCtx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) { calls.push(`fillRect:${this.fillStyle}:${x},${y},${w},${h}`) },
      translate(x: number, y: number) { calls.push(`translate:${x},${y}`) },
      rotate(rad: number) { calls.push(`rotate:${rad.toFixed(4)}`) },
      drawImage(_b: unknown, x: number, y: number) { calls.push(`drawImage:${x},${y}`) },
    }
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
      toBlob: (cb: (b: Blob | null) => void, mime: string) => {
        calls.push(`toBlob:${mime}`)
        cb(new Blob([new Uint8Array([1, 2, 3])], { type: mime }))
      },
    }
    vi.stubGlobal('document', { createElement: () => fakeCanvas })
    const bitmap = { width: 120, height: 80 } as ImageBitmap

    const jpegRes = await renderBitmapToBytes(bitmap, { kind: 'jpeg', rotation: 90 })
    expect(jpegRes.width).toBe(80)
    expect(jpegRes.height).toBe(120)
    expect(fakeCanvas.width).toBe(80)
    expect(fakeCanvas.height).toBe(120)
    expect(calls[0]).toBe('fillRect:#ffffff:0,0,80,120')
    expect(calls).toContain('toBlob:image/jpeg')

    calls.length = 0
    const pngRes = await renderBitmapToBytes(bitmap, { kind: 'png', rotation: 90 })
    expect(pngRes.width).toBe(80)
    expect(pngRes.height).toBe(120)
    expect(calls.some(c => c.startsWith('fillRect'))).toBe(false)
    expect(calls).toContain('toBlob:image/png')
  })
})

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
