// @vitest-environment jsdom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/db/db'
import type { FlowDoc } from './flowDoc'
import { FlowReader } from './FlowReader'

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

function renderLegacyAnnotation(flow: FlowDoc, text: string) {
  const annotation: Annotation = {
    id: 'legacy-highlight', docHash: 'epub-content', blockIdx: 0, text, color: 'yellow', createdAt: 1,
  }
  act(() => root.render(createElement(FlowReader, {
    hash: 'epub-content',
    flow,
    settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 72 },
    annotations: [annotation],
    jump: null,
    onSelection: vi.fn(),
    onProgress: vi.fn(),
    onRestored: vi.fn(),
    onLoaded: vi.fn(),
    scrollRef: createRef<HTMLDivElement>(),
    initialTarget: null,
  })))
}

describe('FlowReader legacy annotation replay', () => {
  it('keeps an old body annotation on the body when the generated chapter title has identical text', () => {
    renderLegacyAnnotation({
      unit: 'chapter',
      segments: [{ title: '第一章', html: '<p>第一章</p>', text: '第一章' }],
      text: '第一章',
    }, '第一章')

    expect(container.querySelector('.flow-body mark[data-ann="legacy-highlight"]')?.textContent)
      .toBe('第一章')
    expect(container.querySelector('.flow-seg-title mark[data-ann="legacy-highlight"]')).toBeNull()
  })

  it('still replays an old cross-chapter selection that includes the intervening chapter title', () => {
    renderLegacyAnnotation({
      unit: 'chapter',
      segments: [
        { title: '第一章', html: '<p>起点正文</p>', text: '起点正文' },
        { title: '第二章', html: '<p>末尾正文</p>', text: '末尾正文' },
      ],
      text: '起点正文\n末尾正文',
    }, '起点正文\n\n第二章\n末尾正文')

    const highlighted = Array.from(container.querySelectorAll('mark[data-ann="legacy-highlight"]'))
      .map((mark) => mark.textContent).join('')
    expect(highlighted).toBe('起点正文第二章末尾正文')
    expect(container.querySelectorAll('.flow-body > p')).toHaveLength(2)
  })
})
