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
