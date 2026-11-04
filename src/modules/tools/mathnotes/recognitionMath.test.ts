import { describe, expect, it } from 'vitest'
import { columnExpression } from './recognitionMath'
import { recoverTrailingEquals, manualExpression } from './mathText'
import { computeLatex } from './compute'
import { recognizeInk } from './recognitionMath'
import { writeText } from './testInk'
import type { Stroke } from './types'

describe('识别结果安全修正', () => {
  it('几何确认存在末尾等号时补回丢失的等号', () => {
    expect(computeLatex(recoverTrailingEquals('12+34', true)).text).toBe('46')
    expect(recoverTrailingEquals('12+34', false)).toBe('12+34')
    expect(recoverTrailingEquals('x+1=2', true)).toBe('x+1=2')
    expect(recoverTrailingEquals('12+', true)).toBe('12+')
  })
  it('竖式保留明确运算符，识别含糊时不猜测', () => {
    expect(computeLatex(columnExpression(['12', 'x3'])!).text).toBe('36')
    expect(computeLatex(columnExpression(['12', '÷3'])!).text).toBe('4')
    expect(columnExpression(['12', '3'])).toBeNull()
    expect(columnExpression(['12', '+x'])).toBeNull()
  })
})


it('手动输入能直接计算，方程中的等号不会被额外追加', () => {
  expect(computeLatex(manualExpression('1+2', false)).text).toBe('3')
  expect(manualExpression('x+1=2', true)).toBe('x+1=2')
  expect(manualExpression('x+1', true)).toBe('x+1=')
})


it('竖式优先逐行识别；无法可靠解析时回退整块识别', async () => {
  const top = writeText('123', 30, 10, 40, 'top')
  const bottom = writeText('+45', 30, 70, 40, 'bottom')
  const bar: Stroke = { id: 'bar', width: 3, points: [{ x: 20, y: 125, p: 0.5, t: 0 }, { x: 150, y: 125, p: 0.5, t: 1 }] }
  const strokes = [...top, ...bottom, bar]
  let calls = 0
  const success = await recognizeInk(strokes, 40, async () => ({ latex: ++calls === 1 ? '123' : '+45', confidence: .9, ms: 10 }))
  expect(success.latex).toBe('123+45=')
  expect(calls).toBe(2)
  calls = 0
  const fallback = await recognizeInk(strokes, 40, async () => ({ latex: ++calls === 1 ? '123' : calls === 2 ? '45' : '123+45=', confidence: .8, ms: 10 }))
  expect(fallback.latex).toBe('123+45=')
  expect(calls).toBe(3)
})
