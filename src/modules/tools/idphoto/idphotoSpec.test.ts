/**
 * 规格测试：预设校验、JSON 序列化/解析、localStorage 自定义规格存取。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_SPECS,
  SPECS_STORAGE_KEY,
  loadCustomSpecs,
  parseSpecsJson,
  saveCustomSpecs,
  serializeSpecs,
  validateSpec,
} from './idphotoSpec'

beforeEach(() => {
  localStorage.clear()
})

describe('BUILTIN_SPECS', () => {
  it('内置预设全部通过校验', () => {
    expect(BUILTIN_SPECS.length).toBeGreaterThanOrEqual(6)
    for (const s of BUILTIN_SPECS) {
      const res = validateSpec(s)
      expect(res.ok).toBe(true)
    }
  })

  it('一寸 295×413、二寸 413×579 与约定一致', () => {
    const yi = BUILTIN_SPECS.find((s) => s.id === 'yicun')
    const er = BUILTIN_SPECS.find((s) => s.id === 'ercun')
    expect(yi?.width).toBe(295)
    expect(yi?.height).toBe(413)
    expect(er?.width).toBe(413)
    expect(er?.height).toBe(579)
    expect(yi?.sheetCount).toBe(8)
    expect(er?.sheetCount).toBe(4)
  })
})

describe('validateSpec', () => {
  const base = { name: '测试', width: 300, height: 400 }

  it('缺省字段用默认值补全', () => {
    const res = validateSpec(base)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.spec.dpi).toBe(300)
    expect(res.spec.format).toBe('jpeg')
    expect(res.spec.minKb).toBeLessThan(res.spec.maxKb)
    expect(res.spec.id).toBe('custom-测试')
  })

  it('name 为空 / 太长报错', () => {
    expect(validateSpec({ ...base, name: '  ' }).ok).toBe(false)
    expect(validateSpec({ ...base, name: 'x'.repeat(33) }).ok).toBe(false)
  })

  it('宽高非整数或出界报错', () => {
    expect(validateSpec({ ...base, width: 300.5 }).ok).toBe(false)
    expect(validateSpec({ ...base, width: 8 }).ok).toBe(false)
    expect(validateSpec({ ...base, height: 9999 }).ok).toBe(false)
    expect(validateSpec({ ...base, width: 'abc' }).ok).toBe(false)
  })

  it('minKb > maxKb、格式非法、头高占比出界报错', () => {
    expect(validateSpec({ ...base, minKb: 30, maxKb: 10 }).ok).toBe(false)
    expect(validateSpec({ ...base, format: 'gif' }).ok).toBe(false)
    expect(validateSpec({ ...base, headRatio: 2 }).ok).toBe(false)
    expect(validateSpec({ ...base, headroom: -1 }).ok).toBe(false)
    expect(validateSpec({ ...base, sheetCount: 0 }).ok).toBe(false)
  })

  it('错误信息带字段名', () => {
    const res = validateSpec({ ...base, width: 5 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('width')
  })
})

describe('parseSpecsJson / serializeSpecs', () => {
  it('数组与 { specs: [...] } 两种写法都认', () => {
    const one = JSON.stringify([{ name: '甲', width: 100, height: 100 }])
    const two = JSON.stringify({ specs: [{ name: '乙', width: 100, height: 100 }] })
    expect(parseSpecsJson(one).ok).toBe(true)
    expect(parseSpecsJson(two).ok).toBe(true)
  })

  it('JSON 坏了 / 顶层类型不对 / 空数组报错', () => {
    expect(parseSpecsJson('{oops').ok).toBe(false)
    expect(parseSpecsJson('42').ok).toBe(false)
    expect(parseSpecsJson('[]').ok).toBe(false)
  })

  it('逐条校验，报错带序号', () => {
    const res = parseSpecsJson(
      JSON.stringify([
        { name: '甲', width: 100, height: 100 },
        { name: '乙', width: -1, height: 100 },
      ]),
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('第 2 条')
  })

  it('serialize → parse 往返一致', () => {
    const text = serializeSpecs(BUILTIN_SPECS.slice(0, 3))
    const res = parseSpecsJson(text)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.specs).toEqual(BUILTIN_SPECS.slice(0, 3))
  })
})

describe('localStorage 自定义规格', () => {
  it('存进去再读出来', () => {
    const specs = [{ ...BUILTIN_SPECS[0], id: 'mine', name: '我的一寸', maxKb: 30 }]
    const saved = saveCustomSpecs(specs)
    expect(saved.ok).toBe(true)
    expect(loadCustomSpecs()).toHaveLength(1)
    expect(loadCustomSpecs()[0].name).toBe('我的一寸')
    expect(localStorage.getItem(SPECS_STORAGE_KEY)).toContain('我的一寸')
  })

  it('非法规格拒绝落盘', () => {
    const before = localStorage.getItem(SPECS_STORAGE_KEY)
    const res = saveCustomSpecs([{ ...BUILTIN_SPECS[0], width: -5 }])
    expect(res.ok).toBe(false)
    expect(localStorage.getItem(SPECS_STORAGE_KEY)).toBe(before)
  })

  it('手改坏 localStorage 不崩，返回空数组', () => {
    localStorage.setItem(SPECS_STORAGE_KEY, '{{{')
    expect(loadCustomSpecs()).toEqual([])
    localStorage.setItem(SPECS_STORAGE_KEY, JSON.stringify([{ name: '', width: 1 }]))
    expect(loadCustomSpecs()).toEqual([])
  })
})
