// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { splitMdBlocks } from './MdReader'
import { LocalRichEditor } from './LocalRichEditor'

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

it('rich edit view previews the table and the source fallback stays verbatim', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(LocalRichEditor, { markdown: MD, onChange })))
  expect(container.querySelector('table')).not.toBeNull()
  expect(container.querySelector('.katex')).not.toBeNull()
  expect(container.querySelector('[aria-label="编辑块源码"]')).not.toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="切换源码模式"]')!.click())
  expect(container.querySelector('textarea')!.value).toBe(MD)
})

it('clicking a plain block opens the TipTap rich editor and 完成 closes it', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(LocalRichEditor, { markdown: MD, onChange })))
  const plain = container.querySelectorAll('[title="点击富文本编辑"]')
  await act(async () => (plain[1] as HTMLElement).click())
  expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="完成块编辑"]')).not.toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="完成块编辑"]')!.click())
  expect(container.querySelector('[contenteditable="true"]')).toBeNull()
})