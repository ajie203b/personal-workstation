import { describe, expect, it } from 'vitest'
import { parsePageExpr, parsePageGroups } from './pdfPages'

describe('parsePageExpr', () => {
  it('空表达式 / 纯空白 → 空数组', () => {
    expect(parsePageExpr('', 10)).toEqual([])
    expect(parsePageExpr('  ,  ,, ', 10)).toEqual([])
  })

  it('单页与区间（含两端）', () => {
    expect(parsePageExpr('5', 10)).toEqual([5])
    expect(parsePageExpr('1-3', 10)).toEqual([1, 2, 3])
    expect(parsePageExpr('8-8', 10)).toEqual([8])
  })

  it('开区间：`8-` 到末页、`-4` 从第 1 页', () => {
    expect(parsePageExpr('8-', 10)).toEqual([8, 9, 10])
    expect(parsePageExpr('-4', 10)).toEqual([1, 2, 3, 4])
    expect(parsePageExpr('-', 3)).toEqual([1, 2, 3])
    // 开区间端点正好是末页
    expect(parsePageExpr('5-', 5)).toEqual([5])
    expect(parsePageExpr('10-', 10)).toEqual([10])
  })

  it('混合逗号 / 全角逗号 / 空白，去重保序', () => {
    expect(parsePageExpr('1-3,5,8-', 10)).toEqual([1, 2, 3, 5, 8, 9, 10])
    expect(parsePageExpr('3,1,3,2,1', 10)).toEqual([3, 1, 2])
    expect(parsePageExpr(' 1 - 3 ， 5 ', 10)).toEqual([1, 2, 3, 5])
    expect(parsePageExpr('1,,2', 10)).toEqual([1, 2])
  })

  it('越界报错：0、超末页、区间端点越界', () => {
    expect(() => parsePageExpr('0', 10)).toThrow(/从 1 开始/)
    expect(() => parsePageExpr('11', 10)).toThrow(/超出范围：文档共 10 页/)
    expect(() => parsePageExpr('1-11', 10)).toThrow(/超出范围/)
    expect(() => parsePageExpr('11-', 10)).toThrow(/超出范围/)
    expect(() => parsePageExpr('-11', 10)).toThrow(/超出范围/)
  })

  it('起始页大于结束页报错', () => {
    expect(() => parsePageExpr('3-1', 10)).toThrow(/起始页大于结束页/)
    expect(() => parsePageExpr('5-2,1', 10)).toThrow(/起始页大于结束页/)
  })

  it('非法写法报错', () => {
    expect(() => parsePageExpr('abc', 10)).toThrow(/无法解析页码/)
    expect(() => parsePageExpr('1.5', 10)).toThrow(/无法解析页码/)
    expect(() => parsePageExpr('1-2-3', 10)).toThrow(/无法解析页码/)
    expect(() => parsePageExpr('--', 10)).toThrow(/无法解析页码/)
  })
})

describe('parsePageGroups', () => {
  it('按分号分段，每段独立解析', () => {
    expect(parsePageGroups('1-3;5;8-', 10)).toEqual([[1, 2, 3], [5], [8, 9, 10]])
    expect(parsePageGroups('1-3；5', 10)).toEqual([[1, 2, 3], [5]])
  })

  it('空段忽略；全空返回空数组', () => {
    expect(parsePageGroups('1-3;;5', 10)).toEqual([[1, 2, 3], [5]])
    expect(parsePageGroups('', 10)).toEqual([])
  })

  it('任一段越界整体报错', () => {
    expect(() => parsePageGroups('1-3;20', 10)).toThrow(/超出范围/)
  })
})
