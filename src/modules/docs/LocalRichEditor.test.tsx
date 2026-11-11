// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { splitMdBlocks } from './MdReader'
import { LocalRichEditor } from './LocalRichEditor'
import type { Editor } from '@tiptap/core'

const MD = '# 标题\n\n正文段落\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n$$\n\\frac{a}{b}\n$$'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('marks table / display math as complex and slices them verbatim', () => {
  const blocks = splitMdBlocks(MD)
  expect(blocks.map(b => b.complex)).toEqual([false, false, true, true])
  expect(blocks[2].source).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  expect(blocks[3].source).toBe('$$\n\\frac{a}{b}\n$$')
})

it('previews TeX delimiters and keeps all math out of the lossy rich text editor', async () => {
  const markdown = String.raw`行内 \(1&lt;a\\le2\)，以及 $x^2$。

\[\frac{a}{b}\]`
  expect(splitMdBlocks(markdown).every(b => b.complex)).toBe(true)
  await act(async () => root.render(createElement(LocalRichEditor, { markdown, onChange: vi.fn(), scrollRef: { current: null } })))
  expect(container.querySelectorAll('.katex')).toHaveLength(3)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="切换源码模式"]')!.click())
  expect(container.querySelector('textarea')!.value).toBe(markdown)
})

it('rich edit view previews the table and the source fallback stays verbatim', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(LocalRichEditor, { markdown: MD, onChange, scrollRef: { current: null } })))
  expect(container.querySelector('table')).not.toBeNull()
  expect(container.querySelector('.katex')).not.toBeNull()
  expect(container.querySelector('[aria-label="编辑块源码"]')).not.toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="切换源码模式"]')!.click())
  expect(container.querySelector('textarea')!.value).toBe(MD)
})

it('edits the whole document in one editor and saves table and formula source intact', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(LocalRichEditor, { markdown: MD, onChange, scrollRef: { current: null } })))
  expect(container.querySelectorAll('[contenteditable="true"]')).toHaveLength(1)
  const content = container.querySelector('.tiptap') as HTMLElement & { editor: Editor }
  expect(content.querySelector('h1')?.textContent).toBe('标题')
  expect(content.querySelector('p')?.textContent).toBe('正文段落')
  expect(container.querySelector('[role="toolbar"] [aria-label="加粗"]')).not.toBeNull()
  await act(async () => { content.editor.commands.insertContentAt(1, '新') })
  const saved = onChange.mock.lastCall?.[0]
  expect(saved).toContain('# 新标题')
  expect(saved).toContain('| a | b |\n| --- | --- |\n| 1 | 2 |')
  expect(saved).toContain('$$\n\\frac{a}{b}\n$$')
})

it('preserves a Markdown example with nested fences when another paragraph changes', async () => {
  const sample = '````markdown\n```js\nconsole.log(1)\n```\n````'
  const onChange = vi.fn()
  await act(async () => root.render(createElement(LocalRichEditor, {
    markdown: `# 标题\n\n${sample}\n\n后续正文`, onChange, scrollRef: { current: null },
  })))
  const content = container.querySelector('.tiptap') as HTMLElement & { editor: Editor }
  await act(async () => { content.editor.commands.insertContentAt(1, '新') })
  expect(onChange.mock.lastCall?.[0]).toBe(`# 新标题\n\n${sample}\n\n后续正文`)
})

it('keeps a recovered table with blank lines intact when the heading is edited', async () => {
  const table = '|\n配置项\n\n|\n\n填什么\n|\n\n| --- | --- |\n\n| 模型 | 示例 |'
  const onChange = vi.fn()
  await act(async () => root.render(createElement(LocalRichEditor, {
    markdown: `# 标题\n\n${table}`, onChange, scrollRef: { current: null },
  })))
  expect(container.querySelector('table')).not.toBeNull()
  const content = container.querySelector('.tiptap') as HTMLElement & { editor: Editor }
  await act(async () => { content.editor.commands.insertContentAt(1, '新') })
  expect(onChange.mock.lastCall?.[0]).toBe(`# 新标题\n\n${table}`)
})
