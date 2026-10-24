import { describe, expect, it } from 'vitest'
import { latexToMath } from './formula'

describe('LaTeX → Word 原生公式', () => {
  it('支持分式、上下标和根式', () => {
    expect(latexToMath('\\frac{a}{b}')).not.toBeNull()
    expect(latexToMath('x_i^2')).not.toBeNull()
    expect(latexToMath('\\sqrt[3]{x+1}')).not.toBeNull()
  })

  it('支持求和、积分和自适应括号', () => {
    expect(latexToMath('\\sum_{i=1}^{n} x_i')).not.toBeNull()
    expect(latexToMath('\\int_{a}^{b} f(x)\\mathrm{d}x')).not.toBeNull()
    expect(latexToMath('\\left(1-\\frac{u}{20}\\right)')).not.toBeNull()
    expect(latexToMath('\\mu_i M_{i-1}+\\lambda_i M_{i+1}=d_i')).not.toBeNull()
  })

  it('复杂环境交给图片兜底', () => {
    expect(latexToMath('\\begin{cases}x+y=1\\\\x-y=0\\end{cases}')).toBeNull()
    expect(latexToMath('\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}')).toBeNull()
  })
})
