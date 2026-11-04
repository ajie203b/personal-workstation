import { expect, it } from 'vitest'
import { selectInLasso, transformStrokes } from './lasso'
const stroke = (id: string, x: number, y: number) => ({ id, width: 2, points: [{ x, y, p: .5, t: 1 }, { x: x + 3, y: y + 3, p: .5, t: 2 }] })
it('套索只选择框内或穿过边界的笔画', () => {
  const polygon = [{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]
  expect(selectInLasso([stroke('inside', 5, 5), stroke('outside', 30, 30), stroke('cross', -1, 10)], polygon)).toEqual(['inside', 'cross'])
})
it('移动和缩放不改变原笔画', () => {
  const source = [stroke('a', 5, 5)]
  const moved = transformStrokes(source, new Set(['a']), 2, 4, 2, {x:0, y:0})
  expect(moved[0].points[0]).toMatchObject({x:12, y:14})
  expect(source[0].points[0]).toMatchObject({x:5, y:5})
})
