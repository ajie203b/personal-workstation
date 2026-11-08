// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { LocalFolder } from '@/lib/localMarkdown'

const { read, list, pick, write, win, closeHandler } = vi.hoisted(() => ({
  read: vi.fn(), list: vi.fn(), pick: vi.fn(), write: vi.fn(),
  win: { setTitle: vi.fn(async () => {}), destroy: vi.fn(async () => {}), onCloseRequested: vi.fn() },
  closeHandler: { current: null as null | ((event: { preventDefault: () => void }) => void) },
}))
vi.mock('@/lib/native', () => ({ isTauri: () => true }))
vi.mock('@/shared/theme', () => ({ useThemeEffect: () => {} }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))
vi.mock('@/lib/localMarkdown', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/localMarkdown')>(), localMarkdown: { read, list, pick, write, defaults: vi.fn() } }))
import { LocalMarkdownPage } from './LocalMarkdownPage'

win.onCloseRequested.mockImplementation(async (handler: NonNullable<typeof closeHandler.current>) => { closeHandler.current = handler; return () => { closeHandler.current = null } })

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let cleanup = () => {}
afterEach(() => { cleanup(); closeHandler.current = null; vi.clearAllMocks() })

it('本地阅读页展示同目录文件、切换文章并生成标题目录', async () => {
  HTMLElement.prototype.scrollTo = () => {}
  const folder: LocalFolder = { directory: 'D:/notes', parent: null, entries: [
    { name: 'a.md', path: 'D:/notes/a.md', directory: false },
    { name: '中文 b.md', path: 'D:/notes/中文 b.md', directory: false },
  ] }
  list.mockResolvedValue(folder)
  read.mockImplementation(async (path: string) => ({ path, version: '1', markdown: path.endsWith('a.md') ? '# 第一篇\n\n## 二级标题\n\n<script>bad()</script>\n\n[中文链接](中文%20b.md)' : '# 第二篇' }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<MemoryRouter initialEntries={['/local-markdown?file=D%3A%2Fnotes%2Fa.md']}><LocalMarkdownPage /></MemoryRouter>))
  expect(host.querySelector('.md-body h1')?.textContent).toBe('第一篇')
  expect(host.querySelector('.md-body script')).toBeNull()
  const outline = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b => b.textContent === '目录')!
  await act(async () => outline.click())
  expect(host.querySelector('[role=tabpanel]')?.textContent).toContain('二级标题')
  await act(async () => host.querySelector<HTMLAnchorElement>('.md-body a')!.click())
  expect(read).toHaveBeenLastCalledWith('D:/notes/中文 b.md')
  expect(host.querySelector('.md-body h1')?.textContent).toBe('第二篇')
  // Explicit refresh checks the document as well as the directory and reports success.
  read.mockResolvedValue({ path: 'D:/notes/中文 b.md', version: '2', markdown: '# 刷新后的正文' })
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新文档"]')!.click())
  expect(host.querySelector('.md-body h1')?.textContent).toBe('刷新后的正文')
  expect(host.querySelector('[aria-label="刷新文档"]')?.getAttribute('data-state')).toBe('success')
  // 打开文档后顶栏只留刷新与设置：打开文件/文件夹、在文档工作站打开都不再出现
  expect(host.querySelector('[aria-label="打开本地文件夹"]')).toBeNull()
  expect(host.querySelector('[aria-label="打开本地 Markdown 文件"]')).toBeNull()
  expect(host.querySelector('[aria-label="在文档工作站打开"]')).toBeNull()
  expect(host.querySelector('[aria-label="阅读设置"]')).not.toBeNull()
})

const notesFolder: LocalFolder = { directory: 'D:/notes', parent: null, entries: [
  { name: 'a.md', path: 'D:/notes/a.md', directory: false },
] }

async function renderPage() {
  HTMLElement.prototype.scrollTo = () => {}
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<MemoryRouter initialEntries={['/local-markdown?file=D%3A%2Fnotes%2Fa.md']}><LocalMarkdownPage /></MemoryRouter>))
  return host
}

function typeDraft(host: HTMLElement, text: string) {
  const textarea = host.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, text)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

it('编辑原文件：Ctrl+S 写回磁盘，完成后回到阅读视图', async () => {
  list.mockResolvedValue(notesFolder)
  read.mockResolvedValue({ path: 'D:/notes/a.md', version: '1', markdown: '# 原始正文' })
  write.mockImplementation(async (path: string, markdown: string) => ({ path, version: '2', markdown }))
  const host = await renderPage()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑文档"]')!.click())
  expect(host.querySelector('textarea')?.value).toBe('# 原始正文')
  await act(async () => typeDraft(host, '# 修改后的正文'))
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })) })
  expect(write).toHaveBeenCalledWith('D:/notes/a.md', '# 修改后的正文', '1')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="完成编辑"]')!.click())
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.querySelector('.md-body h1')?.textContent).toBe('修改后的正文')
})

it('外部修改冲突时暂停保存，可覆盖保存我的修改', async () => {
  list.mockResolvedValue(notesFolder)
  read.mockResolvedValue({ path: 'D:/notes/a.md', version: '1', markdown: '# 原始正文' })
  write.mockRejectedValueOnce('文件已被外部修改，请刷新后重试')
  write.mockImplementation(async (path: string, markdown: string) => ({ path, version: '3', markdown }))
  const host = await renderPage()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑文档"]')!.click())
  await act(async () => typeDraft(host, '# 我的修改'))
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })) })
  expect(host.textContent).toContain('文件已被其他程序修改')
  const force = [...host.querySelectorAll('button')].find(b => b.textContent === '覆盖保存我的修改')!
  await act(async () => force.click())
  expect(write).toHaveBeenLastCalledWith('D:/notes/a.md', '# 我的修改', undefined)
  expect(host.textContent).not.toContain('文件已被其他程序修改')
})

it('编辑中直接关窗：先写回原文件再销毁窗口', async () => {
  list.mockResolvedValue(notesFolder)
  read.mockResolvedValue({ path: 'D:/notes/a.md', version: '1', markdown: '# 原始正文' })
  write.mockImplementation(async (path: string, markdown: string) => ({ path, version: '2', markdown }))
  const host = await renderPage()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑文档"]')!.click())
  await act(async () => typeDraft(host, '# 关窗前的修改'))
  const event = { preventDefault: vi.fn() }
  await act(async () => closeHandler.current!(event))
  expect(event.preventDefault).toHaveBeenCalled()
  expect(write).toHaveBeenCalledWith('D:/notes/a.md', '# 关窗前的修改', '1')
  expect(win.destroy).toHaveBeenCalled()
})

it('关窗时保存冲突：窗口留在原地显示冲突处理', async () => {
  list.mockResolvedValue(notesFolder)
  read.mockResolvedValue({ path: 'D:/notes/a.md', version: '1', markdown: '# 原始正文' })
  write.mockRejectedValue('文件已被外部修改，请刷新后重试')
  const host = await renderPage()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑文档"]')!.click())
  await act(async () => typeDraft(host, '# 未落盘的修改'))
  const event = { preventDefault: vi.fn() }
  await act(async () => closeHandler.current!(event))
  expect(event.preventDefault).toHaveBeenCalled()
  expect(win.destroy).not.toHaveBeenCalled()
  expect(host.textContent).toContain('文件已被其他程序修改')
})

it('阅读态关窗不拦截也不触发保存', async () => {
  list.mockResolvedValue(notesFolder)
  read.mockResolvedValue({ path: 'D:/notes/a.md', version: '1', markdown: '# 原始正文' })
  await renderPage()
  const event = { preventDefault: vi.fn() }
  await act(async () => closeHandler.current!(event))
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(win.destroy).not.toHaveBeenCalled()
})
