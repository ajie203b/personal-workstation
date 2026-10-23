// @vitest-environment jsdom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '@/db/db'
import { MdReader, parseMdBlocks } from './MdReader'

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

function renderAnnotation(text: string, md = '第一段用于复现的高亮文字\n\n第二段用于跨段高亮检查') {
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
    md,
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
  it('assigns TOC entries to actual rendered blocks after table recovery and adjacent headings', () => {
    const md = '# 标题\n正文\n\n|\n配置项\n|\n填什么\n|\n| --- | --- |\n|\n模型\n| 值 |\n\n## 后续'
    expect(parseMdBlocks(md)).toEqual({
      headings: [{ level: 1, text: '标题', blockIdx: 0 }, { level: 2, text: '后续', blockIdx: 3 }],
      total: 4,
    })
  })
  it('renders HTML bold, safe text colors, shading and Markdown math', () => {
    renderAnnotation('', '**普通加粗** <b>HTML加粗</b> <span style="color:#c00000;background-color:#fff2cc">彩色底纹</span>\n\n公式 $x^2$\n\n$$\n\\frac{a}{b}\n$$')
    expect(container.querySelector('strong')?.textContent).toBe('普通加粗')
    expect(container.querySelector('b')?.textContent).toBe('HTML加粗')
    const color = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === '彩色底纹')
    expect(color?.style.color).toBe('rgb(192, 0, 0)')
    expect(color?.style.backgroundColor).toBe('rgb(255, 242, 204)')
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('mfrac')).not.toBeNull()
  })

  it('renders a repaired table and keeps code literals and existing highlights', () => {
    renderAnnotation('', '|\n配置项\n|\n填什么\n|\n| --- | --- |\n|\n模型名\n| **示例** |\n\n==yellow|高亮== 与 `**原样**`')
    expect(container.querySelector('table th')?.textContent).toBe('配置项')
    expect(container.querySelector('table strong')?.textContent).toBe('示例')
    expect(container.querySelector('mark.hl-yellow')?.textContent).toBe('高亮')
    expect(container.querySelector('code')?.textContent).toBe('**原样**')
  })

  it('rejects scripts, event handlers, unsafe styles and links in embedded HTML', () => {
    renderAnnotation('', '<b onclick="alert(1)">安全加粗</b><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">链接</a><span style="position:fixed;background-image:url(https://evil.test/x);color:red">文字</span>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toMatch(/onclick|onerror|javascript:|background-image|position:\s*fixed/)
    expect(container.querySelector('b')?.textContent).toBe('安全加粗')
  })

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
