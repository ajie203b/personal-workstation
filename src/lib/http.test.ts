import { afterEach, expect, it, vi } from 'vitest'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isTauri } from './native'
import { httpBytes, httpText } from './http'

vi.mock('./native', () => ({ isNative: () => false, isTauri: vi.fn(() => false) }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(isTauri).mockReturnValue(false)
})

it.each([
  { name: 'httpText', download: httpText },
  { name: 'httpBytes', download: httpBytes },
])('aborts a stalled response body in $name', async ({ download }) => {
  vi.stubGlobal('fetch', async (_url: string, { signal }: RequestInit) => new Response(
    new ReadableStream({
      start(controller) {
        signal!.addEventListener('abort', () => controller.error(signal!.reason), { once: true })
      },
    }),
  ))

  await expect(download('https://example.test/download', { timeoutMs: 10 }))
    .rejects.toMatchObject({ name: 'TimeoutError' })
}, 1000)

it.each([httpText, httpBytes])('aborts a stalled Tauri body in %s', async (download) => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(tauriFetch).mockImplementation(async (_url, { signal } = {}) => new Response(
    new ReadableStream({
      start(controller) {
        signal!.addEventListener('abort', () => controller.error(signal!.reason), { once: true })
      },
    }),
  ))

  await expect(download('https://example.test/download', { timeoutMs: 10 }))
    .rejects.toMatchObject({ name: 'AbortError' })
}, 1000)

it('reports streaming byte progress with known Content-Length in httpBytes', async () => {
  const part1 = new Uint8Array([1, 2, 3])
  const part2 = new Uint8Array([4, 5, 6, 7])
  vi.stubGlobal('fetch', async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(part1)
        controller.enqueue(part2)
        controller.close()
      },
    }),
    { headers: { 'Content-Length': '7', 'Content-Type': 'application/octet-stream' } },
  ))

  const events: Array<[number, number]> = []
  const res = await httpBytes('https://example.test/file.bin', {
    onProgress: (loaded, total) => events.push([loaded, total]),
  })

  expect(Array.from(new Uint8Array(res.bytes))).toEqual([1, 2, 3, 4, 5, 6, 7])
  expect(events[0]).toEqual([0, 7])
  expect(events).toContainEqual([3, 7])
  expect(events[events.length - 1]).toEqual([7, 7])
})

it('reports streaming byte progress when Content-Length is missing', async () => {
  const part = new Uint8Array([9, 8, 7, 6])
  vi.stubGlobal('fetch', async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(part)
        controller.close()
      },
    }),
  ))

  const events: Array<[number, number]> = []
  const res = await httpBytes('https://example.test/chunked.bin', {
    onProgress: (loaded, total) => events.push([loaded, total]),
  })

  expect(Array.from(new Uint8Array(res.bytes))).toEqual([9, 8, 7, 6])
  expect(events[0]).toEqual([0, 0])
  expect(events).toContainEqual([4, 0])
  expect(events[events.length - 1]).toEqual([4, 4])
})
