import { describe, expect, it } from 'vitest'
import { sampleFunction, sampleCurves } from './plot'
describe('函数图像采样', () => {
  it('识别 y= 和 f(x)= 并计算函数值', () => {
    expect(sampleFunction('y=x^2', -2, 2, 5)).toEqual([4, 1, 0, 1, 4])
    const points = sampleFunction('f(x)=sin(x)', 0, Math.PI, 3)
    expect(points[1]).toBeCloseTo(1)
  })
  it('未定义的位置产生断点，不允许其他未知数', () => {
    expect(sampleFunction('1/x', -1, 1, 3)[1]).toBeNull()
    expect(() => sampleFunction('x+y', -1, 1, 3)).toThrow()
    expect(() => sampleFunction('x=2', -1, 1, 3)).toThrow()
  })
})


it('同时绘制显函数和圆等隐式曲线', () => {
  const curves = sampleCurves('y=x^2\nx^2+y^2=25', -10, 10, 101)
  expect(curves).toHaveLength(2)
  expect(curves[0].kind).toBe('explicit')
  expect(curves[1].kind).toBe('implicit')
  if (curves[1].kind !== 'implicit') throw new Error('expected implicit')
  expect(curves[1].segments.length).toBeGreaterThan(40)
  const xs = curves[1].segments.flatMap(s => [s[0], s[2]])
  expect(Math.min(...xs)).toBeCloseTo(100, 0)
  expect(Math.max(...xs)).toBeCloseTo(300, 0)
})

it('不支持的曲线给出明确错误', () => {
  expect(() => sampleCurves('x^2+y^2+z^2=1', -10, 10, 101)).toThrow()
  expect(() => sampleCurves('x=y=1', -10, 10, 101)).toThrow()
})


it('支持椭圆、双曲线及右侧也含 y 的方程', () => {
  for (const expression of ['x^2/9+y^2/4=1', 'x^2-y^2=1', 'y=x^2+y^2']) {
    const result = sampleCurves(expression, -10, 10, 101)[0]
    expect(result.kind).toBe('implicit')
    if (result.kind === 'implicit') expect(result.segments.length).toBeGreaterThan(0)
  }
}, 20000)


it('参数曲线按指定 t 范围采样，包括无定义点', () => {
  const c = sampleCurves('(cos(t), sin(t))', -5, 5, 5, 0, Math.PI * 2)[0]
  expect(c.kind).toBe('parametric')
  if (c.kind !== 'parametric') throw new Error('expected parametric')
  expect(c.points[0]?.[0]).toBeCloseTo(1)
  expect(c.points[1]?.[1]).toBeCloseTo(1)
  const gap = sampleCurves('(t, 1/t)', -5, 5, 3, -1, 1)[0]
  if (gap.kind !== 'parametric') throw new Error('expected parametric')
  expect(gap.points[1]).toBeNull()
  expect(() => sampleCurves('(t, x)', -5, 5, 3, 0, 1)).toThrow()
})

it('三维曲面采样并校验变量', () => {
  const c = sampleCurves('z=x^2+y^2', -2, 2, 31)[0]
  expect(c.kind).toBe('surface')
  if (c.kind !== 'surface') throw new Error('expected surface')
  expect(c.values[0][0]).toBeCloseTo(8)
  expect(c.values[15][15]).toBeCloseTo(0)
  expect(() => sampleCurves('z=x+t', -2, 2, 31)).toThrow()
  expect(() => sampleCurves('z=x\ny=x', -2, 2, 31)).toThrow()
})


it('支持三维参数曲线，例如螺旋线', () => {
  const curve = sampleCurves('(cos(t), sin(t), t)', -10, 10, 5, 0, Math.PI * 2)[0]
  expect(curve.kind).toBe('parametric3d')
  if (curve.kind !== 'parametric3d') throw new Error('expected 3D curve')
  expect(curve.points[0]?.[0]).toBeCloseTo(1)
  expect(curve.points[1]?.[1]).toBeCloseTo(1)
  expect(curve.points[4]?.[2]).toBeCloseTo(Math.PI * 2)
  expect(() => sampleCurves('(cos(t),sin(t),t)\ny=x', -10, 10, 5)).toThrow()
})


it('平移后按新的 x 和 y 范围采样', () => {
  const curves = sampleCurves('y=x\nx^2+y^2=1', -1, 1, 5, 0, 1, {}, 2, 3)
  if (curves[0].kind !== 'explicit') throw new Error('expected explicit')
  expect(curves[0].values).toEqual([1, 1.5, 2, 2.5, 3])
  if (curves[1].kind !== 'implicit') throw new Error('expected implicit')
  expect(curves[1].segments).toHaveLength(0)
})
