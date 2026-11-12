import { readFileSync } from 'node:fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('锁定相同版本的 Tauri HTTP 前端和原生插件', () => {
  const cargo = readFileSync(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  const npm = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const version = npm.dependencies['@tauri-apps/plugin-http']
  expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(cargo.match(/^tauri-plugin-http = "=(\d+\.\d+\.\d+)"$/m)?.[1]).toBe(version)
})

it.each([
  { method: 'MKCOL', body: undefined },
  { method: 'GET', body: undefined },
  { method: 'PUT', body: '{"tasks":[]}' },
])('WebDAV $method 通过 Tauri 2.9 的 IPC 传递参数和请求体', async ({ method, body }) => {
  const url = 'https://dav.test/kairos/sync.json'
  const authorization = 'Basic dTpw'
  const invoke = vi.fn(async (command: string, _payload: unknown, _options?: { headers: Record<string, string> }) => {
    switch (command) {
      case 'plugin:http|fetch': return 1
      case 'plugin:http|fetch_send': return { status: 200, statusText: 'OK', url, headers: [['etag', '"rev"']], rid: 2 }
      case 'plugin:http|fetch_read_body': return new Uint8Array([1])
      default: throw new Error(command)
    }
  })
  vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } })

  const response = await tauriFetch(url, { method, body, headers: { Authorization: authorization }, connectTimeout: 15000 })
  await response.text()
  expect(response.status).toBe(200)
  expect(response.headers.get('etag')).toBe('"rev"')

  const [command, payload, options] = invoke.mock.calls[0]
  expect(command).toBe('plugin:http|fetch')
  expect(payload).toEqual(new TextEncoder().encode(body ?? ''))
  const config = JSON.parse(decodeURIComponent(options?.headers['client-config'] ?? ''))
  expect(config).toMatchObject({ method, url, connectTimeout: 15000 })
  expect(config.headers).toContainEqual(['authorization', authorization])
})
