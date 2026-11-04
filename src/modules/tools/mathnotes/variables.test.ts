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
