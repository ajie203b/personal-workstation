import { describe, expect, it } from 'vitest'
import { evaluatePage } from './variables'
import { sampleCurves } from './plot'

describe('页面变量', () => {
  it('变量按页面顺序赋值，修改后下游结果随之更新', () => {
    const result = evaluatePage([{ key: 'a', latex: 'a=5' }, { key: 'b', latex: 'a+3=' }])
    expect(result.variables.a).toBe(5)
    expect(result.results.b.text).toBe('8')
    const changed = evaluatePage([{ key: 'a', latex: 'a=6' }, { key: 'b', latex: 'a+3=' }])
    expect(changed.results.b.text).toBe('9')
  })
  it('赋值可引用之前的变量，变量不能提前使用', () => {
    const result = evaluatePage([{ key: 'a', latex: 'a=2' }, { key: 'b', latex: 'b=a+3' }, { key: 'c', latex: 'b*2=' }])
    expect(result.variables.b).toBe(5)
    expect(result.results.c.text).toBe('10')
    expect(evaluatePage([{ key: 'a', latex: 'a=b+1' }]).variables.a).toBeUndefined()
  })
})


it('图像引用变量，同时保留坐标轴变量', () => {
  const curve = sampleCurves('y=a*x', -1, 1, 3, 0, 1, { a: 3, x: 99 })[0]
  expect(curve.kind).toBe('explicit')
  if (curve.kind === 'explicit') expect(curve.values).toEqual([-3, 0, 3])
})


it('错误的重新赋值不能继续沿用旧值', () => {
  const page = evaluatePage([{ key: 'one', latex: 'a=5' }, { key: 'two', latex: 'a=b+1' }, { key: 'three', latex: 'a+3=' }])
  expect(page.variables.a).toBeUndefined()
  expect(page.results.two.kind).toBe('error')
  expect(page.results.three.kind).toBe('error')
})


it('单位算式不被同名变量错误替换', () => {
  const page = evaluatePage([{ key: 'v', latex: 'm=5' }, { key: 'u', latex: '2m+30cm=' }])
  expect(page.results.u.text).toBe('2.3 m')
})

it('支持多字符与下标变量名，并返回 ✓=val 注册徽标信息', () => {
  const page = evaluatePage([
    { key: 'p', latex: 'price = 10' },
    { key: 'v', latex: 'v_0 = 5' },
    { key: 'q', latex: '2price + v_{0} =' },
  ])
  expect(page.variables.price).toBe(10)
  expect(page.variables.v_0).toBe(5)
  expect(page.results.p.assigned).toEqual({ name: 'price', value: '10' })
  expect(page.results.v.assigned).toEqual({ name: 'v_0', value: '5' })
  expect(page.results.q.text).toBe('25')
})

it('保留数学常量 i / e 与函数名禁止作为变量赋值并给出明确提示', () => {
  const res = evaluatePage([
    { key: 'iAssign', latex: 'i = 1' },
    { key: 'eAssign', latex: 'e = 2.7' },
    { key: 'sinAssign', latex: 'sin = 3' },
    { key: 'piAssign', latex: '\\pi = 3' },
    { key: 'expr', latex: '1+i=' },
  ])
  expect(res.variables.i).toBeUndefined()
  expect(res.variables.e).toBeUndefined()
  expect(res.results.iAssign.kind).toBe('error')
  expect(res.results.iAssign.message).toContain('保留')
  expect(res.results.eAssign.kind).toBe('error')
  expect(res.results.sinAssign.kind).toBe('error')
  expect(res.results.piAssign.kind).toBe('error')
  expect(res.results.expr.text).toBe('1+i')
})

it('非结尾等号方程也代换已定义变量（如 x^2 - a^2 = 0）', () => {
  const page = evaluatePage([
    { key: 'a', latex: 'a = 2' },
    { key: 'eq', latex: 'x^2 - a^2 = 0' },
  ])
  expect(page.results.eq.kind).toBe('solutions')
  expect(page.results.eq.latex).toContain('2')
  expect(page.results.eq.latex).toContain('-2')
})

it('积分、求导与求和中的绑定变量不被同名的页面变量误替换', () => {
  const page = evaluatePage([
    { key: 'x', latex: 'x = 3' },
    { key: 'k', latex: 'k = 2' },
    { key: 'intg', latex: '\\int_{0}^{1} x^{2} dx=' },
    { key: 'sum', latex: '\\sum_{k=1}^{10} k =' },
  ])
  expect(page.results.intg.latex).toBe('\\frac{1}{3}')
  expect(page.results.sum.text).toBe('55')
})
