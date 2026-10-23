// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { collectTextAnchors, wrapText } from './textAnchors'

afterEach(() => {
  document.body.replaceChildren()
})

function mount(html: string): HTMLElement[] {
  document.body.innerHTML = html
  return Array.from(document.body.children) as HTMLElement[]
}

describe('collectTextAnchors', () => {
  it('highlights Word equations without inserting HTML marks inside MathML tokens', () => {
    const [paragraph] = mount('<p>公式 <math><mfrac><mi>a</mi><mi>b</mi></mfrac></math> 结束</p>')
    expect(wrapText(paragraph, 'ab', 'equation', 'yellow')).toBe(true)
    expect(paragraph.querySelector('math mark')).toBeNull()
    expect(paragraph.querySelector('mark[data-ann="equation"] > math mfrac')).not.toBeNull()
    expect(paragraph.querySelector('math')?.textContent).toBe('ab')
  })

  it('keeps KaTeX HTML and accessibility math together when highlighting a formula', () => {
    const [paragraph] = mount('<p><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html">x</span></span></p>')
    expect(wrapText(paragraph, 'xx', 'equation', 'green')).toBe(true)
    expect(paragraph.querySelectorAll('mark')).toHaveLength(1)
    expect(paragraph.querySelector('mark > .katex')).not.toBeNull()
  })
  it('records the selected portion of each paragraph without inventing paragraph separators', () => {
    const [first, second] = mount('<p>第一段文字</p><p>第二段文字</p>')
    const range = document.createRange()
    range.setStart(first.firstChild!, 2)
    range.setEnd(second.firstChild!, 3)

    expect(collectTextAnchors(range, [first, second])).toEqual([
      { blockIdx: 0, start: 2, end: 5, text: '段文字' },
      { blockIdx: 1, start: 0, end: 3, text: '第二段' },
    ])
  })

  it('anchors the second occurrence of an identical excerpt instead of finding the first', () => {
    const [paragraph] = mount('<p>重复摘录 / 重复摘录</p>')
    const range = document.createRange()
    range.setStart(paragraph.firstChild!, 7)
    range.setEnd(paragraph.firstChild!, 11)

    expect(collectTextAnchors(range, [paragraph])).toEqual([
      { blockIdx: 0, start: 7, end: 11, text: '重复摘录' },
    ])
  })

  it('omits nonintersecting roots and preserves indices when a root is unavailable', () => {
    const [before, selected, after] = mount('<p>未选第一块</p><p>选中内容</p><p>未选最后块</p>')
    const range = document.createRange()
    range.setStart(selected.firstChild!, 1)
    range.setEnd(selected.firstChild!, 3)

    expect(collectTextAnchors(range, [before, null, selected, after])).toEqual([
      { blockIdx: 2, start: 1, end: 3, text: '中内' },
    ])
  })

  it('measures offsets across inline formatting and includes actual selected whitespace', () => {
    const [paragraph] = mount('<p>开头 <strong>粗体文字</strong> 结尾</p>')
    const range = document.createRange()
    range.setStart(paragraph.firstChild!, 1)
    range.setEnd(paragraph.lastChild!, 2)

    expect(collectTextAnchors(range, [paragraph])).toEqual([
      { blockIdx: 0, start: 1, end: 9, text: '头 粗体文字 结' },
    ])
  })

  it('preserves newlines that exist in text nodes', () => {
    const [paragraph] = mount('<p>甲\n  <em>乙</em> 丙</p>')
    const range = document.createRange()
    range.selectNodeContents(paragraph)

    expect(collectTextAnchors(range, [paragraph])).toEqual([
      { blockIdx: 0, start: 0, end: 7, text: '甲\n  乙 丙' },
    ])
  })

  it('excludes generated chapter headings outside the supplied body roots', () => {
    const [first, , second] = mount('<div>第一章正文</div><h2>第 2 章</h2><div>第二章正文</div>')
    const range = document.createRange()
    range.setStart(first.firstChild!, 1)
    range.setEnd(second.firstChild!, 2)

    expect(collectTextAnchors(range, [first, second])).toEqual([
      { blockIdx: 0, start: 1, end: 5, text: '一章正文' },
      { blockIdx: 1, start: 0, end: 2, text: '第二' },
    ])
  })
})
