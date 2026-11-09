// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { countMarkdownCharacters, MarkdownWordCount } from './MarkdownWordCount'

describe('Markdown 总字数', () => {
  it('排除空白，中文、英文、标点及 Unicode 字符各计一个字符', () => {
    expect(countMarkdownCharacters(' \n\t\r\u3000')).toBe(0)
    expect(countMarkdownCharacters('你好，Kairos！\n📝')).toBe(11)
    expect(countMarkdownCharacters('# 标题\n\n**正文**')).toBe(9)
  })

  it('显示总数，并在切换文章或编辑后更新', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      act(() => root.render(createElement(MarkdownWordCount, { markdown: '你好' })))
      expect(host.textContent).toBe('总字数：2')
      act(() => root.render(createElement(MarkdownWordCount, { markdown: '你好世界' })))
      expect(host.textContent).toBe('总字数：4')
      act(() => root.render(createElement(MarkdownWordCount, { markdown: '' })))
      expect(host.textContent).toBe('总字数：0')
    } finally { act(() => root.unmount()) }
  })
})
