/**
 * 同步落库的三方对账（纯函数，便于单测）。
 *
 * 为什么需要它：同步是一条「读本地快照 → 网络往返 → 合并 → 写回本地」的长链路。
 * 网络往返期间用户完全可能在同一个库里新建/修改任务，如果直接拿合并结果覆盖，
 * 这些改动会被旧快照顶掉（新建的还会因为「合并结果里没有 = 远端删过」被裁掉）。
 *
 * 这里用三份数据判断每个主键该写谁：
 * - merged：拉回来的合并结果（要推给远端的内容）
 * - base：发起同步时读到的本地快照（合并用的输入）
 * - current：写入前重新读到的本地数据（可能已经变了）
 *
 * 规则：
 * - current 的时间戳比 base 新（或 base 里根本没有这个键）→ 说明同步期间本地改过/新建过，
 *   保留 current，并记为「待推送」，下一轮同步会把它带上
 * - current 有、merged 没有、但 base 有 → 远端确实删了它（墓碑），本地跟着删
 * - current 有、merged 没有、base 也没有 → 同步期间刚建的，绝不删
 */
export interface ReconcileInput<T> {
  /** 合并结果 */
  merged: T[]
  /** 发起同步时的本地快照 */
  base: T[]
  /** 写入前重新读到的本地数据 */
  current: T[]
  key: (row: T) => string
  ts: (row: T) => number
}

export interface ReconcilePlan<T> {
  /** 需要写入的行（合并结果，或同步期间改动过的本地行） */
  put: T[]
  /** 需要删除的主键 */
  del: string[]
  /** 同步期间产生的本地改动条数（这批改动本轮没推上去） */
  pending: number
}

export function planReconcile<T>({ merged, base, current, key, ts }: ReconcileInput<T>): ReconcilePlan<T> {
  const baseTs = new Map<string, number>()
  for (const row of base) baseTs.set(key(row), ts(row))

  const currentMap = new Map<string, T>()
  for (const row of current) currentMap.set(key(row), row)

  const put: T[] = []
  const seen = new Set<string>()
  let pending = 0

  for (const row of merged) {
    const k = key(row)
    seen.add(k)
    const cur = currentMap.get(k)
    const baseAt = baseTs.get(k)
    // 同步期间本地改过（或本地新建）→ 本地版本更新，留本地
    if (cur && (baseAt === undefined || ts(cur) > baseAt)) {
      put.push(cur)
      pending++
      continue
    }
    put.push(row)
  }

  const del: string[] = []
  for (const k of currentMap.keys()) {
    if (seen.has(k)) continue
    if (!baseTs.has(k)) {
      // 同步期间新建的本地记录：远端当然没有，保留并等下一轮推送
      pending++
      continue
    }
    del.push(k)
  }

  return { put, del, pending }
}
