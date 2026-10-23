// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
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
})
