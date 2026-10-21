import { describe, expect, it } from 'vitest'
import { MAX_SNAPSHOT_VERSION, validateSnapshot } from './snapshotSchema'

const task = {
  id: 't1', title: '读书', tier: 'today', priority: 1, status: 'todo', tags: [],
  createdAt: 1000, updatedAt: 1000,
}

const base = { app: 'personal-workstation', version: 4, tasks: [task] }

describe('validateSnapshot', () => {
  it('正常快照通过', () => {
    const r = validateSnapshot(base)
    expect(r.version).toBe(4)
    expect(r.warnings).toEqual([])
  })

  it('应用标识不对直接拒绝', () => {
    expect(() => validateSnapshot({ ...base, app: 'other-app' })).toThrow(/应用标识/)
    expect(() => validateSnapshot([1, 2, 3])).toThrow(/不是 JSON 对象/)
  })

  it('未知版本拒绝（含未来版本）', () => {
    expect(() => validateSnapshot({ ...base, version: MAX_SNAPSHOT_VERSION + 1 })).toThrow(/不支持的版本/)
    expect(() => validateSnapshot({ ...base, version: 0 })).toThrow(/不支持的版本/)
    expect(() => validateSnapshot({ ...base, version: 4.5 })).toThrow(/不支持的版本/)
  })

  it('字段类型不对拒绝，并指出具体位置', () => {
    expect(() => validateSnapshot({ ...base, tasks: [{ ...task, title: 123 }] }))
      .toThrow(/tasks\[0\]\.title 应为字符串/)
    expect(() => validateSnapshot({ ...base, tasks: [{ ...task, tier: 'somedayy' }] }))
      .toThrow(/tasks\[0\]\.tier/)
    expect(() => validateSnapshot({ ...base, tasks: [{ ...task, createdAt: '1000' }] }))
      .toThrow(/tasks\[0\]\.createdAt 应为数字/)
    expect(() => validateSnapshot({ ...base, tasks: ['not-object'] }))
      .toThrow(/tasks\[0\] 应为对象/)
  })

  it('缺少 tasks 数组拒绝', () => {
    expect(() => validateSnapshot({ app: 'personal-workstation', version: 4 })).toThrow(/缺少 tasks 数组/)
  })

  it('引用缺失只警告，不阻断（老备份本来可能带孤儿数据）', () => {
    const r = validateSnapshot({
      ...base,
      docs: [],
      annotations: [{ id: 'a1', docHash: 'gone', text: '摘录', color: 'yellow', createdAt: 1 }],
    })
    expect(r.warnings[0]).toMatch(/批注指向的文档不在备份里/)
  })

  it('文档缺本体只警告', () => {
    const r = validateSnapshot({
      ...base,
      docs: [{ id: 'd1', hash: 'h1', title: 'x', kind: 'pdf', size: 10, addedAt: 1 }],
      blobRows: [],
    })
    expect(r.warnings.join()).toMatch(/缺少本体文件/)
  })
})
