import { expect, it } from 'vitest'
import { computeLatex } from './compute'
it('不同长度、质量和时间单位可以离线相加和换算', () => {
  expect(computeLatex('2m+30cm=').text).toBe('2.3 m')
  expect(computeLatex('1kg+500g=').text).toBe('1.5 kg')
  expect(computeLatex('5km→m').text).toBe('5000 m')
  expect(computeLatex('2小时+30分钟=').text).toBe('2.5 小时')
})
it('不兼容的单位提示错误，普通代数不误判为单位', () => {
  expect(computeLatex('2m+3kg=').kind).toBe('error')
  expect(computeLatex('2m+1=').kind).not.toBe('error')
  expect(computeLatex('5km→kg').kind).toBe('error')
})
