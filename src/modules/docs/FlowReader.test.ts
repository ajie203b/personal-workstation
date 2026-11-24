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

  it('omits duplicate .flow-seg-title when chapter HTML begins with a bare or div-wrapped matching heading', () => {
    renderLegacyAnnotation({
      unit: 'chapter',
      segments: [
        { title: '第一卷', html: '<div class="volume-page"><h1>第一卷</h1><p>共 2 章</p></div>', text: '第一卷\n共 2 章' },
        { title: '第1章', html: '<h1>第1章</h1><p>正文</p>', text: '第1章\n正文' },
      ],
      text: '第一卷\n共 2 章\n第1章\n正文',
    }, '正文')

    expect(container.querySelectorAll('.flow-seg-title')).toHaveLength(0)
    expect(container.querySelectorAll('.flow-body h1')).toHaveLength(2)
  })

  it('syncs --reader-width CSS variable across width adjustments', () => {
    const flow: FlowDoc = {
      unit: 'doc',
      segments: [{ title: '正文', html: '<div class="word-content"><section class="docx"><article><p>第一段</p><p>第二段</p></article></section></div>', text: '第一段 第二段' }],
      text: '第一段 第二段',
    }
    const scrollRef = createRef<HTMLDivElement>()
    act(() => root.render(createElement(FlowReader, {
      hash: 'docx-width',
      flow,
      settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 80 },
      annotations: [],
      jump: null,
      onSelection: vi.fn(),
      onProgress: vi.fn(),
      onRestored: vi.fn(),
      onLoaded: vi.fn(),
      scrollRef,
      initialTarget: null,
    })))
    const prose = container.querySelector<HTMLElement>('.reader-prose')!
    expect(prose.style.getPropertyValue('--reader-width')).toBe('80%')

    act(() => root.render(createElement(FlowReader, {
      hash: 'docx-width',
      flow,
      settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 100 },
      annotations: [],
      jump: null,
      onSelection: vi.fn(),
      onProgress: vi.fn(),
      onRestored: vi.fn(),
      onLoaded: vi.fn(),
      scrollRef,
      initialTarget: null,
    })))
    expect(prose.style.getPropertyValue('--reader-width')).toBe('100%')
  })

  it('opens annotation popover when clicking an inline highlight mark and supports f0@ratio bookmark jump', () => {
    const flow: FlowDoc = {
      unit: 'doc',
      segments: [{ title: '正文', html: '<p>前置段落</p><p>高亮目标句子</p>', text: '前置段落 高亮目标句子' }],
      text: '前置段落 高亮目标句子',
    }
    const annotation: Annotation = {
      id: 'ann-click-1', docHash: 'docx-ann', blockIdx: 0, text: '高亮目标句子', color: 'green', createdAt: 1,
    }
    const onSelectAnnotation = vi.fn()
    const scrollRef = createRef<HTMLDivElement>()
    const scrollToSpy = vi.fn()
    HTMLElement.prototype.scrollTo = scrollToSpy

    act(() => root.render(createElement(FlowReader, {
      hash: 'docx-ann',
      flow,
      settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 80 },
      annotations: [annotation],
      jump: null,
      onSelection: vi.fn(),
      onSelectAnnotation,
      onProgress: vi.fn(),
      onRestored: vi.fn(),
      onLoaded: vi.fn(),
      scrollRef,
      initialTarget: null,
    })))

    const mark = container.querySelector<HTMLElement>('mark[data-ann="ann-click-1"]')!
    expect(mark).not.toBeNull()
    act(() => { mark.click() })
    expect(onSelectAnnotation).toHaveBeenCalledWith(expect.objectContaining({ ann: annotation }))

    const segEl = container.querySelector<HTMLElement>('[data-seg="0"]')!
    Object.defineProperty(segEl, 'offsetTop', { configurable: true, get: () => 40 })
    Object.defineProperty(segEl, 'offsetHeight', { configurable: true, get: () => 2000 })

    act(() => root.render(createElement(FlowReader, {
      hash: 'docx-ann',
      flow,
      settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 80 },
      annotations: [annotation],
      jump: { anchor: 'f0@0.36', ts: 99 },
      onSelection: vi.fn(),
      onSelectAnnotation,
      onProgress: vi.fn(),
      onRestored: vi.fn(),
      onLoaded: vi.fn(),
      scrollRef,
      initialTarget: null,
    })))
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 760, behavior: 'smooth' })
  })
})
