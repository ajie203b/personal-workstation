// @vitest-environment jsdom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/db/db'
import { MdReader } from './MdReader'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderAnnotation(text: string) {
  const annotation: Annotation = {
    id: 'selected-excerpt',
    docHash: 'markdown-document',
    blockIdx: 0,
    text,
    color: 'yellow',
    createdAt: 1,
  }
  act(() => root.render(createElement(MdReader, {
    hash: 'markdown-document',
    md: '第一段用于复现的高亮文字\n\n第二段用于跨段高亮检查',
    settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 72 },
    annotations: [annotation],
    jump: null,
    onSelection: vi.fn(),
    onProgress: vi.fn(),
    onRestored: vi.fn(),
    scrollRef: createRef<HTMLDivElement>(),
    initialTarget: null,
  })))
}

describe('Markdown reading highlights', () => {
  it('renders a saved selection inside one paragraph', () => {
    renderAnnotation('第一段用于复现的高亮')

    expect(container.querySelector('mark[data-ann="selected-excerpt"]')?.textContent)
      .toBe('第一段用于复现的高亮')
  })

  it('renders all of a saved selection that crosses paragraph boundaries', () => {
    // Reproduced with a real mouse drag from the first paragraph into the second.
    // Browser Selection.toString() inserts two newlines between the paragraphs.
    renderAnnotation('第一段用于复现的高亮文字\n\n第二段用于跨段高亮检')

    const highlighted = Array.from(container.querySelectorAll('mark[data-ann="selected-excerpt"]'))
      .map((mark) => mark.textContent).join('')
    expect(highlighted).toBe('第一段用于复现的高亮文字第二段用于跨段高亮检')
    // Highlighting must preserve the Markdown block structure.
    expect(container.querySelectorAll('.md-body > p')).toHaveLength(2)
  })
})
