// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { collectImageUrls, mapWithConcurrency, sniffImageMime } from './articleImages'

describe('mapWithConcurrency', () => {
  it('结果按入参顺序回填，且同时在跑的任务不超过上限', async () => {
    let running = 0
    let peak = 0
    const items = [40, 10, 30, 20, 5]
    const out = await mapWithConcurrency(items, 2, async (ms, i) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, ms))
      running--
      return `r${i}`
    })
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBeGreaterThan(1) // 确实并发了
  })

  it('空列表与上限为 1 都正常', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 1, async (n) => n * 2)).toEqual([2, 4])
  })
})

describe('sniffImageMime', () => {
  it('按魔数认 PNG / JPEG / GIF / WebP', () => {
    const b = (...xs: number[]) => new Uint8Array(xs)
    expect(sniffImageMime(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffImageMime(b(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageMime(new TextEncoder().encode('GIF89a...'))).toBe('image/gif')
    const webp = new Uint8Array(16)
    webp.set(new TextEncoder().encode('RIFF'), 0)
    webp.set(new TextEncoder().encode('WEBP'), 8)
    expect(sniffImageMime(webp)).toBe('image/webp')
    expect(sniffImageMime(b(0, 1, 2))).toBe('image/jpeg') // 认不出保底 JPEG
  })
})

describe('collectImageUrls', () => {
  it('只收 http(s) 外链图并去重，data: 内嵌图不算', () => {
    const urls = collectImageUrls(`
      <img src="https://a.test/1.png">
      <img src="https://a.test/1.png">
      <img src="data:image/png;base64,AAAA">
      <img src="/relative.png">
      <img>
    `)
    expect(urls).toEqual(['https://a.test/1.png'])
  })
})
