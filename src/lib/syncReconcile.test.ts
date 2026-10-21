import { describe, expect, it } from 'vitest'
import { planReconcile } from './syncReconcile'

interface Row {
  id: string
  updatedAt: number
}

const row = (id: string, updatedAt: number): Row => ({ id, updatedAt })

/**
 * 对应「同步期间继续编辑」这一整类问题：
 * 同步是「读快照 → 网络往返 → 合并 → 写回」，往返期间用户改了库，
 * 写回时不能拿旧快照的结论去覆盖。
 */
describe('planReconcile', () => {
  it('同步期间新建的记录不会被当成「远端已删」清掉', () => {
    const base = [row('a', 100)]
    const merged = [row('a', 100)]
    const current = [row('a', 100), row('new', 500)]
    const plan = planReconcile({ merged, base, current, key: (r) => r.id, ts: (r) => r.updatedAt })
    expect(plan.del).toEqual([])
    expect(plan.pending).toBe(1)
    // 新建的那条本来就在库里，不需要再写一遍
    expect(plan.put.map((r) => r.id)).toEqual(['a'])
  })

  it('同步期间的修改以本地为准（不写回合并用的旧版本）', () => {
    const base = [row('a', 100)]
    const merged = [row('a', 100)]
    const current = [row('a', 900)]
    const plan = planReconcile({ merged, base, current, key: (r) => r.id, ts: (r) => r.updatedAt })
    expect(plan.put).toEqual([row('a', 900)])
    expect(plan.del).toEqual([])
    expect(plan.pending).toBe(1)
  })

  it('远端确实删了（墓碑）才删本地', () => {
    const base = [row('a', 100), row('b', 100)]
    const merged = [row('a', 100)]
    const current = [row('a', 100), row('b', 100)]
    const plan = planReconcile({ merged, base, current, key: (r) => r.id, ts: (r) => r.updatedAt })
    expect(plan.del).toEqual(['b'])
    expect(plan.pending).toBe(0)
  })

  it('远端新记录照常写入', () => {
    const plan = planReconcile({
      merged: [row('remote', 200)],
      base: [],
      current: [],
      key: (r) => r.id,
      ts: (r) => r.updatedAt,
    })
    expect(plan.put).toEqual([row('remote', 200)])
    expect(plan.del).toEqual([])
  })

  it('无改动时不产生多余写入', () => {
    const plan = planReconcile({
      merged: [row('a', 100)],
      base: [row('a', 100)],
      current: [row('a', 100)],
      key: (r) => r.id,
      ts: (r) => r.updatedAt,
    })
    expect(plan.put).toEqual([row('a', 100)])
    expect(plan.pending).toBe(0)
    expect(plan.del).toEqual([])
  })
})
