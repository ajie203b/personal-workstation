// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeWordLayout } from './wordDoc'
import { normalizeWordTypography } from './wordTypography'
import { sanitizeHtml } from '@/lib/sanitizeHtml'

function render(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  normalizeWordTypography(root)
  return root
}

describe('Word reading typography', () => {
  it('uses identifier, number and operator tokens while keeping the original text', () => {
    const root = render('<p>公式 <math><ms style="font-family:Times New Roman;font-size:9pt;color:red">ax + 2</ms></math>。</p>')
    expect(root.textContent).toBe('公式 ax + 2。')
    expect(root.querySelector('math mi')?.textContent).toBe('ax')
    expect(root.querySelector('math mn')?.textContent).toBe('2')
    expect(root.querySelector('math mo')?.textContent).toBe('+')
    expect(root.querySelector('math ms')).toBeNull()
    expect(root.querySelector('math [style]')?.getAttribute('style')).not.toMatch(/font-family|font-size/)
    expect(root.querySelector('math [style]')?.getAttribute('style')).toContain('color: red')
    expect(root.querySelector('.word-equation-block')).toBeNull()
  })

  it('aligns simultaneous subscript and superscript on the same base', () => {
    const root = render('<p><math><msup><mrow><msub><mrow><ms>x</ms></mrow><mn>i</mn></msub></mrow><mn>2</mn></msup></math></p>')
    const script = root.querySelector('msubsup')!
    expect(script).not.toBeNull()
    expect(Array.from(script.children).map((element) => element.textContent)).toEqual(['x', 'i', '2'])
    expect(root.querySelector('msup')).toBeNull()
  })

  it('sets standalone equations in display style and keeps equation numbers outside the math', () => {
    const root = render('<p><span><math><mfrac><ms>a</ms><ms>b</ms></mfrac></math></span><span> (2.1)</span></p>')
    expect(root.querySelector('p')?.classList.contains('word-equation-block')).toBe(true)
    expect(root.querySelector('math')?.getAttribute('display')).toBe('block')
    expect(root.querySelector('.word-equation-number')?.textContent).toBe(' (2.1)')
    expect(root.querySelector('math')?.textContent).toBe('ab')
  })

  it('keeps function names upright, variables italic and MathML attributes after sanitizing', () => {
    const root = render('<p><math><ms>sin</ms><ms>x</ms><ms>中文</ms></math></p>')
    expect(root.querySelector('mi[mathvariant="normal"]')?.textContent).toBe('sin')
    expect(root.querySelector('mi:not([mathvariant])')?.textContent).toBe('x')
    expect(root.querySelector('mtext')?.textContent).toBe('中文')
    expect(sanitizeHtml(root.innerHTML)).toContain('mathvariant="normal"')
  })

  it('keeps compound exponents in a layout row instead of an invalid number token', () => {
    const root = render('<p><math><msup><ms>x</ms><mn><ms>n+1</ms></mn></msup></math></p>')
    const exponent = root.querySelector('msup')!.children[1]
    expect(exponent.localName).toBe('mrow')
    expect(exponent.querySelector('mi')?.textContent).toBe('n')
    expect(exponent.querySelector('mo')?.textContent).toBe('+')
    expect(exponent.querySelector('mn')?.textContent).toBe('1')
    expect(root.textContent).toBe('xn+1')
  })

  it('recognizes Word heading styles and large first-paragraph titles without changing authored formatting', () => {
    const root = render('<p><span style="font-size:18pt;font-weight:bold;color:#c00000">论文标题</span></p><p class="docx_heading2">第二章</p><p style="background-color:#fff2cc;text-indent:2em">正文段落</p>')
    expect(root.querySelector('p')?.classList.contains('word-title')).toBe(true)
    expect(root.querySelector('p.docx_heading2')?.classList.contains('word-heading-2')).toBe(true)
    expect(root.querySelector('p:last-child')?.getAttribute('style')).toContain('text-indent:2em')
    expect(root.querySelector('span')?.getAttribute('style')).toContain('color:#c00000')
  })

  it('normalizes fixed-width Word callout tables, multi-column grids, and drawing boxes for fluid prose widths', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<section class="docx" style="width: 595.3pt; padding: 72pt 90pt;">',
      '<article style="width: 415.3pt">',
      '<table style="width: 453.55pt; margin-left: 12pt"><colgroup><col style="width: 453.55pt"></colgroup><tbody><tr><td style="width: 453.55pt; background-color: #f4f1ea"><p style="line-height: 22pt">夹注精读原文卡片</p></td></tr></tbody></table>',
      '<table style="width: 400pt"><colgroup><col style="width: 100pt"><col style="width: 300pt"></colgroup><tbody><tr><td style="width: 100pt">项</td><td style="width: 300pt">说明</td></tr></tbody></table>',
      '<table style="width: 480pt"><colgroup><col style="width: 120pt"><col style="width: 120pt"><col style="width: 120pt"><col style="width: 120pt"></colgroup><tbody><tr><td>A</td><td>B</td><td>C</td><td>D</td></tr></tbody></table>',
      '<p><div style="display: inline-block; width: 420pt; height: 210pt"><img src="data:image/png;base64,iVBORw0KGgo=" style="width: 100%; height: 100%"></div></p>',
      '</article>',
      '</section>',
    ].join('')

    normalizeWordLayout(root)
    const cleaned = sanitizeHtml(root.innerHTML)
    const parsed = new DOMParser().parseFromString(cleaned, 'text/html')

    const callout = parsed.querySelector<HTMLTableElement>('table.word-callout-table')!
    expect(callout).not.toBeNull()
    expect(callout.style.width).toBe('')
    expect(callout.style.marginLeft).toBe('')
    expect(callout.querySelector('col')?.style.width).toBe('100%')
    expect(callout.querySelector('td')?.style.width).toBe('')
    expect(callout.querySelector('td')?.style.backgroundColor).not.toBe('')
    expect(callout.querySelector('p')?.style.lineHeight).toBe('')

    const twoCol = parsed.querySelectorAll('table')[1]
    const cols = Array.from(twoCol.querySelectorAll('col')).map((c) => c.style.width)
    expect(cols).toEqual(['25%', '75%'])

    const wideWrap = parsed.querySelector('.word-table-scroll')
    expect(wideWrap).not.toBeNull()
    expect(wideWrap?.querySelector('table')).not.toBeNull()

    const figBox = parsed.querySelector<HTMLElement>('.word-figure-box')!
    expect(figBox).not.toBeNull()
    expect(figBox.style.maxWidth).toBe('100%')
    expect(figBox.style.height).toBe('auto')
    expect(figBox.style.getPropertyValue('aspect-ratio')).toContain('420 / 210')
    expect(figBox.querySelector('img')?.style.height).toBe('auto')
  })
})
