// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  native: false,
  path: '',
  opened: false,
  saved: null as { dataBase64: string; fileName: string; mimeType: string } | null,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
  registerPlugin: () => ({
    saveToDownloads: async (opts: { dataBase64: string; fileName: string; mimeType: string }) => {
      state.saved = opts
      return { path: state.path, uri: 'content://test' }
    },
    openSavedLocation: async () => {
      state.opened = true
    },
  }),
}))

import { blobToBase64, openSavedAction, saveBlob } from './saveFile'

beforeEach(() => {
  state.native = false
  state.path = ''
  state.opened = false
  state.saved = null
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

describe('blobToBase64', () => {
  it('小内容按标准 base64 编码', async () => {
    expect(await blobToBase64(new Blob(['hello']))).toBe('aGVsbG8=')
  })

  it('超过一个分块的大内容也能完整拼接（对照 atob 字节数）', async () => {
    const big = new Uint8Array(70_000).fill(0x61) // 'a' × 70000
    const b64 = await blobToBase64(new Blob([big]))
    expect(atob(b64).length).toBe(70_000)
  })

  it('中文内容与 TextEncoder 字节一致', async () => {
    const text = '说好一年一词条'
    const b64 = await blobToBase64(new Blob([text]))
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe(text)
  })
})

describe('saveBlob · 浏览器', () => {
  it('走 <a download>，返回浏览器下载目录', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const where = await saveBlob(new Blob(['x']), '书名.txt')
    expect(where).toBe('浏览器下载目录')
    expect(click).toHaveBeenCalledTimes(1)
    expect(state.saved).toBeNull()
    click.mockRestore()
  })
})

describe('saveBlob · 安卓壳', () => {
  it('交给原生写「下载」，返回原生报的路径', async () => {
    state.native = true
    state.path = '下载/个人工作站/书名.epub'
    const where = await saveBlob(new Blob(['epub'], { type: 'application/epub+zip' }), '书名.epub')
    expect(where).toBe('下载/个人工作站/书名.epub')
    expect(state.saved).toEqual({
      dataBase64: await blobToBase64(new Blob(['epub'])),
      fileName: '书名.epub',
      mimeType: 'application/epub+zip',
    })
  })
})

describe('openSavedAction', () => {
  it('网页端没有可打开的下载目录，不显示按钮', () => {
    expect(openSavedAction()).toBeUndefined()
  })

  it('安卓壳点按钮会调用原生打开目录', () => {
    state.native = true
    const action = openSavedAction()
    expect(action?.label).toBe('打开位置')
    action?.run()
    expect(state.opened).toBe(true)
  })
})
