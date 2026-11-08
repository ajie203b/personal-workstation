// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { LocalFolder } from '@/lib/localMarkdown'

const { read, list } = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/native', () => ({ isTauri: () => true }))
vi.mock('@/shared/theme', () => ({ useThemeEffect: () => {} }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTitle: async () => {} }) }))
vi.mock('@/lib/localMarkdown', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/localMarkdown')>(), localMarkdown: { read, list } }))
import { LocalMarkdownPage } from './LocalMarkdownPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let cleanup = () => {}
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('本地阅读页展示同目录文件、切换文章并生成标题目录', async () => {
  HTMLElement.prototype.scrollTo = () => {}
  const folder: LocalFolder = { root: 'D:/notes', directory: 'D:/notes', parent: null, entries: [
    { name: 'a.md', path: 'D:/notes/a.md', directory: false },
    { name: '中文 b.md', path: 'D:/notes/中文 b.md', directory: false },
  ] }
  list.mockResolvedValue(folder)
  read.mockImplementation(async (path: string) => ({ path, version: '1', markdown: path.endsWith('a.md') ? '# 第一篇\n\n## 二级标题\n\n<script>bad()</script>\n\n[中文链接](中文%20b.md)' : '# 第二篇' }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<MemoryRouter initialEntries={['/local-markdown?file=D%3A%2Fnotes%2Fa.md']}><LocalMarkdownPage /></MemoryRouter>))
  expect(host.querySelector('article h1')?.textContent).toBe('第一篇')
  expect(host.querySelector('article script')).toBeNull()
  const outline = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b => b.textContent === '目录')!
  await act(async () => outline.click())
  expect(host.querySelector('[role=tabpanel]')?.textContent).toContain('二级标题')
  await act(async () => host.querySelector<HTMLAnchorElement>('article a')!.click())
  expect(read).toHaveBeenLastCalledWith('D:/notes/中文 b.md')
  expect(host.querySelector('article h1')?.textContent).toBe('第二篇')
})
