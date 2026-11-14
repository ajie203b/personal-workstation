import { afterEach, expect, it, vi } from 'vitest'
import { httpBytes, httpText } from './http'

afterEach(() => vi.unstubAllGlobals())

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
