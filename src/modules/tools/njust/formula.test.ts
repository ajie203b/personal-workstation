import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph } from 'docx'
import JSZip from 'jszip'
import { latexToMath, mathNode } from './formula'

describe('LaTeX → Word 原生公式', () => {
  it('支持分式、上下标和根式', () => {
    expect(latexToMath('\\frac{a}{b}')).not.toBeNull()
    expect(latexToMath('x_i^2')).not.toBeNull()
    expect(latexToMath('\\sqrt[3]{x+1}')).not.toBeNull()
  })

  it('支持求和、积分、连乘与任意顺序上下限和自适应括号', () => {
    expect(latexToMath('\\sum_{i=1}^{n} x_i')).not.toBeNull()
    expect(latexToMath('\\sum^{n}_{i=1} x_i')).not.toBeNull()
    expect(latexToMath('\\prod^{n}_{i=1} a_i')).not.toBeNull()
    expect(latexToMath('\\int^{b}_{a} f(x)\\mathrm{d}x')).not.toBeNull()
    expect(latexToMath('\\left(1-\\frac{u}{20}\\right)')).not.toBeNull()
    expect(latexToMath('\\mu_i M_{i-1}+\\lambda_i M_{i+1}=d_i')).not.toBeNull()
  })

  it('支持 hat / bar / vec / dot / ddot / tilde 原生重音（<m:acc>）', async () => {
    const expr = '\\hat{x} + \\bar{y} + \\vec{v} + \\dot{q} + \\ddot{q} + \\tilde{z}'
    const comps = latexToMath(expr)
    expect(comps).not.toBeNull()
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [mathNode(comps!)] })] }],
    })
    const buf = await Packer.toArrayBuffer(doc)
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('<m:acc>')
    expect((xml.match(/<m:acc>/g) ?? []).length).toBe(6)
  })

  it('复杂环境交给图片兜底', () => {
    expect(latexToMath('\\begin{cases}x+y=1\\\\x-y=0\\end{cases}')).toBeNull()
    expect(latexToMath('\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}')).toBeNull()
  })
})
