import { describe, expect, it } from 'vitest'
import { complexNearlyEqual, computeLatex, flattenColumnArithmetic, formatNumber, normalizeLatex } from './compute'

describe('normalizeLatex', () => {
  it('去掉识别模型的排版空白与数字间空格', () => {
    expect(normalizeLatex('1 2 \\!+\\! 3 4 \\!=')).toBe('12 + 34 =')
  })
  it('\\mathrm 包裹的函数名还原成命令', () => {
    expect(normalizeLatex('\\mathrm{sin} x')).toBe('\\sin x')
    expect(normalizeLatex('\\mathrm{lg} 100')).toBe('\\log_{10} 100')
  })
  it('组合数 / 排列数记号', () => {
    expect(normalizeLatex('C_{5}^{2}')).toBe('\\binom{5}{2}')
    expect(normalizeLatex('\\mathrm{A}_5^2')).toBe('\\frac{5!}{(5-2)!}')
  })
  it('数字间的 x 当乘号（式子里没有其他变量时）', () => {
    expect(normalizeLatex('3x4=')).toBe('3\\times 4=')
    expect(normalizeLatex('3x+4=7')).toBe('3x+4=7')
  })
  it('后面紧跟运算符的乘号其实是手写的 x', () => {
    expect(normalizeLatex('3 \\times+1=7')).toBe('3 x+1=7')
    expect(computeLatex('3 \\times+1=7').latex).toBe('x=2')
    expect(normalizeLatex('2\\times 3=')).toBe('2\\times 3=')
  })
})

describe('computeLatex', () => {
  const inline = (latex: string) => {
    const r = computeLatex(latex)
    expect(r.kind).toBe('inline')
    return r
  }

  it('四则运算', () => {
    expect(inline('1 2 \\!+\\! 3 4 \\!=').text).toBe('46')
    expect(inline('1+2\\times3=').text).toBe('7')
    expect(inline('3x4=').text).toBe('12')
    expect(inline('0.1+0.2=').text).toBe('0.3')
  })
  it('分数给精确值并附带小数', () => {
    const r = inline('\\frac{1}{3}+\\frac{1}{6}=')
    expect(r.latex).toBe('\\frac{1}{2}')
    expect(r.alt).toBe('0.5')
  })
  it('三角（弧度与角度）、对数', () => {
    expect(inline('\\sin\\frac{\\pi}{6}=').latex).toBe('\\frac{1}{2}')
    expect(inline('\\cos 60^{\\circ}=').latex).toBe('\\frac{1}{2}')
    expect(inline('\\log_{2}8=').text).toBe('3')
    expect(inline('\\mathrm{lg} 1000=').text).toBe('3')
  })
  it('根式给精确值 + 近似', () => {
    const r = inline('\\sqrt{2}=')
    expect(r.latex).toBe('\\sqrt{2}')
    expect(r.alt).toBe('1.414213562')
  })
  it('复数', () => {
    expect(inline('(1+2i)(3-i)=').text).toBe('5+5i')
  })
  it('阶乘、组合、排列', () => {
    expect(inline('5!=').text).toBe('120')
    expect(inline('C_{5}^{2}=').text).toBe('10')
    expect(inline('A_{5}^{2}=').text).toBe('20')
  })
  it('简单概率', () => {
    expect(inline('\\frac{\\binom{4}{2}}{\\binom{52}{2}}=').latex).toBe('\\frac{1}{221}')
  })
  it('求导、定积分、不定积分', () => {
    expect(inline('\\frac{d}{dx}x^{3}=').latex).toBe('3x^2')
    expect(inline('\\int_{0}^{1}x^{2}dx=').latex).toBe('\\frac{1}{3}')
    expect(inline('\\int x^{2}dx=').latex).toBe('\\frac{x^3}{3}+C')
  })
  it('没写等号的方程：解显示在下方', () => {
    const r = computeLatex('x^{2}-5x+6=0')
    expect(r.kind).toBe('solutions')
    expect(r.latex).toContain('x_{1}=3')
    expect(r.latex).toContain('x_{2}=2')
  })
  it('一元一次方程', () => {
    const r = computeLatex('2x+3=7')
    expect(r.kind).toBe('solutions')
    expect(r.latex).toBe('x=2')
  })
  it('方程组（cases 与 \\left\\{ array 两种写法）', () => {
    expect(computeLatex('\\begin{cases}x+y=3\\\\x-y=1\\end{cases}').latex).toBe('x=2,\\ y=1')
    expect(computeLatex('\\left\\{\\begin{array}{l}x+y=3\\\\x-y=1\\end{array}\\right.').latex).toBe('x=2,\\ y=1')
  })
  it('矩阵乘法 / 求逆 / 行列式', () => {
    const m = computeLatex('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\begin{pmatrix}1\\\\1\\end{pmatrix}')
    expect(m.kind).toBe('matrix')
    expect(m.latex).toBe('\\begin{pmatrix} 3 \\\\ 7 \\end{pmatrix}')
    const inv = computeLatex('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}=')
    expect(inv.latex).toBe('\\begin{pmatrix} -2 & 1 \\\\ \\frac{3}{2} & -\\frac{1}{2} \\end{pmatrix}')
    expect(inline('\\det\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}=').text).toBe('-2')
  })
  it('竖式展平', () => {
    expect(flattenColumnArithmetic(['123', '+456'])).toBe('123+456')
    expect(flattenColumnArithmetic(['1&2', '3&4'])).toBeNull()
    expect(computeLatex('\\begin{array}{r}123\\\\+456\\\\\\hline\\end{array}').text).toBe('579')
  })
  it('不带等号的普通算式不打扰', () => {
    expect(computeLatex('1+2').kind).toBe('none')
  })
  it('验算等式', () => {
    expect(computeLatex('2+2=4').text).toBe('✓')
  })
  it('识别不全时报错而不是崩溃', () => {
    expect(computeLatex('3+\\frac{=').kind).toBe('error')
  })
})

describe('formatNumber', () => {
  it('10 位有效数字与科学计数', () => {
    expect(formatNumber(1 / 3).text).toBe('0.3333333333')
    expect(formatNumber(2 ** 60).text).toBe('1.152922×10^18')
    expect(formatNumber(-0).text).toBe('0')
  })
})

describe('验算：复数等式同时比较实部与虚部（回归）', () => {
  const verdict = (latex: string) => computeLatex(latex).text
  it('虚部不同判 ✗', () => {
    expect(verdict('i=2i')).not.toBe('✓')
    expect(verdict('1+i=1+2i')).not.toBe('✓')
    expect(computeLatex('i=2i').latex).toContain('\\ne')
    expect(computeLatex('1+i=1+2i').latex).toContain('\\ne')
  })
  it('真正相等的复数判 ✓', () => {
    expect(verdict('i=i')).toBe('✓')
    expect(verdict('(1+i)^2=2i')).toBe('✓')
  })
  it('实数验算不受影响', () => {
    expect(verdict('2+2=4')).toBe('✓')
    expect(verdict('2+2=5')).not.toBe('✓')
    expect(verdict('0.1+0.2=0.3')).toBe('✓')
  })
  it('complexNearlyEqual 的容差', () => {
    expect(complexNearlyEqual([0, 1], [0, 2])).toBe(false)
    expect(complexNearlyEqual([1e12, 1], [1e12, 1 + 1e-6])).toBe(true)
    expect(complexNearlyEqual([0, 1], [0, 1 + 1e-6])).toBe(false)
    expect(complexNearlyEqual([NaN, 0], [NaN, 0])).toBe(false)
  })
})


it('仅在数字算式上下文纠正常见字符，保留未知数', () => {
  expect(computeLatex('1O+2=').text).toBe('12')
  expect(computeLatex('8−3=').text).toBe('5')
  expect(normalizeLatex('O+x=1')).toBe('O+x=1')
})


it('加减乘除竖式分行结果都能计算', () => {
  for (const [rows, answer] of [[['12', '+3'], '15'], [['12', '-3'], '9'], [['12', '\\times3'], '36'], [['12', '\\div3'], '4']] as const) {
    const flat = flattenColumnArithmetic([...rows])
    expect(flat).not.toBeNull()
    expect(computeLatex(`${flat}=`).text).toBe(answer)
  }
})
