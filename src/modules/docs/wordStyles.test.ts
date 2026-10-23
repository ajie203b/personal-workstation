// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { scopeWordStyles } from './wordStyles'

describe('Word stylesheet isolation', () => {
  it('scopes every selector, keeps safe document colors and native numbering counters', () => {
    const css = scopeWordStyles(':root { counter-reset: item; } .docx, p.title { color: red; font-weight: bold; } p.number:before { content: counter(item) ". "; counter-increment: item; }', 'word-test')
    expect(css).toContain('.word-test { counter-reset: item }')
    expect(css).toContain('.word-test .docx,.word-test p.title')
    expect(css).toContain('.word-test p.number:before')
    expect(css).toContain('content: counter(item)')
  })

  it('drops external CSS, resource URLs, positioning and unparsed declarations', () => {
    const css = scopeWordStyles('@import "https://evil.test/x"; @font-face { font-family: evil; src: url(https://evil.test/font); } body { color: red; position: fixed; content: url(https://evil.test/x); width: expression(alert(1)); --docx-font: url(https://evil.test/font); }', 'word-test')
    expect(css).toContain('.word-test body { color: red }')
    expect(css).not.toMatch(/@import|@font-face|evil\.test|position|expression/)
  })
})
