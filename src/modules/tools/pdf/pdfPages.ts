/**
 * 页码表达式解析（PDF 工具箱 v1）。
 *
 * 语法：逗号分隔多个项，项有四种形态（页码一律 1 起）：
 *   `5`    第 5 页
 *   `1-3`  第 1 到 3 页（含两端）
 *   `8-`   第 8 页到末页（开区间）
 *   `-4`   第 1 页到第 4 页
 *
 * 规则：结果去重保序（同一页只留首次出现的位置）；越界 / 非法直接抛 Error，
 * 消息面向用户（可直接进 toast），调用方不用再拼上下文。
 */

/** 单项里的数字必须是正整数且在总页数内 */
function toPage(raw: string, token: string, totalPages: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`无法解析页码「${token}」，请用「1-3,5,8-」这样的写法`)
  const n = Number(raw)
  if (n < 1) throw new Error(`页码「${token}」无效：页码从 1 开始`)
  if (n > totalPages) throw new Error(`页码「${token}」超出范围：文档共 ${totalPages} 页`)
  return n
}

/** 解析一段页码表达式 → 页码数组（1 起，去重保序） */
export function parsePageExpr(expr: string, totalPages: number): number[] {
  if (!Number.isInteger(totalPages) || totalPages < 0) throw new Error('总页数无效')
  const out: number[] = []
  const seen = new Set<number>()
  const push = (n: number) => {
    if (!seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  for (const raw of expr.split(/[,，]/)) {
    const token = raw.trim()
    if (!token) continue // 容忍 `1,,2` 这种手滑
    // 允许「1 - 3」这种带空格写法
    const range = /^(\d*)\s*-\s*(\d*)$/.exec(token)
    if (range) {
      const start = range[1] === '' ? 1 : toPage(range[1], token, totalPages)
      const end = range[2] === '' ? totalPages : toPage(range[2], token, totalPages)
      if (start > end) throw new Error(`页码范围「${token}」起始页大于结束页`)
      for (let p = start; p <= end; p++) push(p)
      continue
    }
    push(toPage(token, token, totalPages))
  }
  return out
}

/**
 * 拆分分段解析：`;`（全角 `；`）分段，每段是一条独立的页码表达式。
 * 「1-3;5;8-」→ 三份输出。空段忽略；一段都不剩就返回空数组，由调用方提示。
 */
export function parsePageGroups(expr: string, totalPages: number): number[][] {
  const groups: number[][] = []
  for (const part of expr.split(/[;；]/)) {
    const pages = parsePageExpr(part, totalPages)
    if (pages.length) groups.push(pages)
  }
  return groups
}
