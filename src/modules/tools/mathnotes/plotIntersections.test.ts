import { describe, expect, it } from 'vitest'
import { findIntersections, nearestCurvePoint } from './plotIntersections'
import { sampleCurves, type PlotCurve } from './plot'

describe('曲线交点', () => {
  it('计算两条直线的交点并去重', () => {
    const curves: PlotCurve[] = [
      { kind: 'explicit', label: 'y=x', values: [-2, -1, 0, 1, 2] },
      { kind: 'explicit', label: 'y=-x', values: [2, 1, 0, -1, -2] },
    ]
    const result = findIntersections(curves, 2)
    expect(result.points).toHaveLength(1)
    expect(result.points[0]).toMatchObject({ first: 0, second: 1 })
    expect(result.points[0].x).toBeCloseTo(0)
    expect(result.points[0].y).toBeCloseTo(0)
  })
  it('不将断点两侧连接，也不把重合直线当作无数交点', () => {
    const a: PlotCurve = { kind: 'explicit', label: 'a', values: [-1, null, 1] }
    const b: PlotCurve = { kind: 'explicit', label: 'b', values: [0, 0, 0] }
    expect(findIntersections([a, b], 1).points).toHaveLength(0)
    expect(findIntersections([b, { ...b, label: 'c' }], 1).points).toHaveLength(0)
  })
  it('支持参数曲线与隐式曲线交点，并排除视窗外的交点', () => {
    const curves: PlotCurve[] = [
      { kind: 'implicit', label: 'x=0', segments: [[200, 0, 200, 400]] },
      { kind: 'parametric', label: 'y=0', points: [[-1, 0], [1, 0]] },
    ]
    const points = findIntersections(curves, 1).points
    expect(points).toHaveLength(1)
    expect(points[0].x).toBeCloseTo(0)
    expect(points[0].y).toBeCloseTo(0)
  })
})


it('真实函数采样可以找到抛物线与直线的两个交点', () => {
  const curves = sampleCurves('y=x^2\ny=1', -2, 2, 241)
  const points = findIntersections(curves, 2).points
  expect(points).toHaveLength(2)
  expect(points[0].x).toBeCloseTo(-1, 2)
  expect(points[1].x).toBeCloseTo(1, 2)
  expect(points[0].y).toBeCloseTo(1, 2)
})


it('平移坐标系后能查看曲线上的近似坐标', () => {
  const curve: PlotCurve = { kind: 'explicit', label: 'y=x', values: [1, 2, 3] }
  const result = nearestCurvePoint([curve], 1, 200, 200, 2, 2)
  expect(result?.x).toBeCloseTo(2)
  expect(result?.y).toBeCloseTo(2)
  expect(result?.label).toBe('y=x')
})
