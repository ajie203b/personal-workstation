// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  clearFindMarks,
  findRangesInText,
  highlightDomMatches,
  normalizeForFind,
  setActiveFindMark,
} from './docFind'

describe('docFind normalization and matching', () => {
  it('collapses ASCII spaces case-insensitively and preserves source offsets', () => {
    const raw = '  Hello   WORLD  and hello world '
    const ranges = findRangesInText(raw, 'hello world')
    expect(ranges).toHaveLength(2)
    expect(raw.slice(ranges[0].start, ranges[0].end)).toBe('Hello   WORLD')
    expect(raw.slice(ranges[1].start, ranges[1].end)).toBe('hello world')
  })

  it('drops whitespace between adjacent CJK chars without merging ASCII words', () => {
    const raw = '这是 人 工  智 能 与 hello world 模型'
    const cjk = findRangesInText(raw, '人工智能')
    expect(cjk).toHaveLength(1)
    expect(raw.slice(cjk[0].start, cjk[0].end)).toBe('人 工  智 能')

    expect(findRangesInText(raw, 'helloworld')).toHaveLength(0)
    expect(normalizeForFind('中 文  abc  123').normalized).toBe('中文 abc 123')
  })
})

describe('docFind DOM highlight and active mark lifecycle', () => {
  it('highlights across inline elements, skips math DOM, switches active hit, and cleans up cleanly', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <p>First <strong>he</strong>llo world</p>
      <p><span class="katex-mathml"><math><mi>hello world</mi></math></span></p>
      <p>Second <mark data-ann="a1">hello</mark> world</p>
    `
    const paragraphs = Array.from(container.querySelectorAll<HTMLElement>('p'))
    const result = highlightDomMatches(paragraphs, 'hello world')

    expect(result.total).toBe(2)
    expect(result.matchRoots).toEqual([0, 2])
    expect(container.querySelectorAll('mark[data-find]')).toHaveLength(4) // 2 split segments per match

    const active0 = setActiveFindMark(container, 0)
    expect(active0?.dataset.find).toBe('0')
    expect(container.querySelectorAll('mark.find-hit-active')).toHaveLength(2)

    const active1 = setActiveFindMark(container, 1)
    expect(active1?.dataset.find).toBe('1')
    expect(container.querySelectorAll('mark.find-hit-active')).toHaveLength(2)
    expect(container.querySelector('mark[data-find="0"].find-hit-active')).toBeNull()

    clearFindMarks(paragraphs)
    expect(container.querySelectorAll('mark[data-find]')).toHaveLength(0)
    expect(container.querySelector('mark[data-ann="a1"]')?.textContent).toBe('hello')
    expect(container.querySelector('strong')?.textContent).toBe('he')
  })
})
