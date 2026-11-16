/**
 * 合成与排版测试：透明底 PNG 跳过 fillRect、排版画布添加 #CBD5E1 细裁切边框。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { composePhotoCanvas, composeSheetCanvas } from './idphotoCompose'
import { SHEET_5IN } from './idphotoLayout'
import { BUILTIN_SPECS } from './idphotoSpec'

function mockCanvasEnv() {
  const fillRects: Array<{ fillStyle: unknown; w: number; h: number }> = []
  const strokeRects: Array<{ strokeStyle: unknown; lineWidth: number }> = []
  const createElementOrig = document.createElement.bind(document)

  const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = createElementOrig(tag)
    if (tag === 'canvas') {
      const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, imageSmoothingQuality: 'low' }
      const ctx = {
        get fillStyle() { return state.fillStyle },
        set fillStyle(v: string) { state.fillStyle = v },
        get strokeStyle() { return state.strokeStyle },
        set strokeStyle(v: string) { state.strokeStyle = v },
        get lineWidth() { return state.lineWidth },
        set lineWidth(v: number) { state.lineWidth = v },
        get imageSmoothingQuality() { return state.imageSmoothingQuality },
        set imageSmoothingQuality(v: string) { state.imageSmoothingQuality = v },
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: vi.fn(),
        fillRect: (_x: number, _y: number, w: number, h: number) => {
          fillRects.push({ fillStyle: state.fillStyle, w, h })
        },
        strokeRect: () => {
          strokeRects.push({ strokeStyle: state.strokeStyle, lineWidth: state.lineWidth })
        },
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
      }
      vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    }
    return el
  }) as typeof document.createElement)

  return { fillRects, strokeRects, restore: () => spy.mockRestore() }
}

describe('composePhotoCanvas / composeSheetCanvas', () => {
  it('bg === "transparent" 时跳过底色 fillRect，保留透明背景', () => {
    const { fillRects, restore } = mockCanvasEnv()
    try {
      const spec = BUILTIN_SPECS[0]
      composePhotoCanvas(
        {
          cleaned: new Uint8ClampedArray(10 * 10 * 4),
          alpha: new Float32Array(100).fill(0.5),
          width: 10,
          height: 10,
          crop: { x: 0, y: 0, width: 10, height: 10 },
          bg: 'transparent',
        },
        spec,
      )
      expect(fillRects).toHaveLength(0)

      composePhotoCanvas(
        {
          cleaned: new Uint8ClampedArray(10 * 10 * 4),
          alpha: new Float32Array(100).fill(0.5),
          width: 10,
          height: 10,
          crop: { x: 0, y: 0, width: 10, height: 10 },
          bg: '#FFFFFF',
        },
        spec,
      )
      expect(fillRects).toHaveLength(1)
      expect(fillRects[0].fillStyle).toBe('#FFFFFF')
    } finally {
      restore()
    }
  })

  it('composeSheetCanvas 为每格绘制 1px #CBD5E1 裁切细框且支持不同纸张预设', () => {
    const { strokeRects, restore } = mockCanvasEnv()
    try {
      const spec = BUILTIN_SPECS[0]
      const photo = document.createElement('canvas')
      const sheet = composeSheetCanvas(photo, spec, SHEET_5IN, 4)
      expect(sheet.width).toBe(SHEET_5IN.width)
      expect(sheet.height).toBe(SHEET_5IN.height)
      expect(strokeRects.length).toBe(4)
      for (const s of strokeRects) {
        expect(s.strokeStyle).toBe('#CBD5E1')
        expect(s.lineWidth).toBe(1)
      }
    } finally {
      restore()
    }
  })
})
