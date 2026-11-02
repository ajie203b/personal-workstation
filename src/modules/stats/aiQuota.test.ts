import { describe, expect, it } from 'vitest'
import { mergeQuotaRecords, quotaSummary } from './aiQuota'

describe('额度计算', () => {
  it('计算剩余量与进度', () => expect(quotaSummary({ total: 100, used: 35 })).toEqual({ remaining: 65, percent: 35, exceeded: false }))
  it('缺少数据时不伪造剩余额度', () => expect(quotaSummary({ total: null, used: 0 })).toBeNull())
  it('超额时进度封顶并提示超额', () => expect(quotaSummary({ total: 100, used: 120 })).toEqual({ remaining: 0, percent: 100, exceeded: true }))
  it('零额度仍能正确标识已超额', () => expect(quotaSummary({ total: 0, used: 1 })).toEqual({ remaining: 0, percent: 100, exceeded: true }))
})

describe('额度记录同步', () => {
  it('合并两端新建与旧格式记录，并采用较新的修改', () => {
    const a = { id: 'a', name: 'old' }
    const b = { id: 'b', name: 'new' }
    const newer = { id: 'a', name: 'edited', updatedAt: 5 }
    expect(mergeQuotaRecords([a], [b, newer])).toEqual([newer, b])
  })
  it('删除标记不被离线设备旧数据复活，合并顺序不影响结果', () => {
    const entry = { id: 'a', name: 'old', updatedAt: 10 }
    const deleted = { id: 'a', deleted: true, updatedAt: 9 }
    expect(mergeQuotaRecords([entry], [deleted])).toEqual([deleted])
    expect(mergeQuotaRecords([deleted], [entry])).toEqual([deleted])
  })
  it('相同时间的不同内容采用确定性结果', () => {
    const a = { id: 'a', name: 'first', updatedAt: 1 }
    const b = { id: 'a', name: 'second', updatedAt: 1 }
    expect(mergeQuotaRecords([a], [b])).toEqual(mergeQuotaRecords([b], [a]))
  })
  it('拒绝损坏的同步记录', () => expect(() => mergeQuotaRecords([], {})).toThrow())
})
