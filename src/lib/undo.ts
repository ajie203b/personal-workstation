/**
 * 最近一次可撤销操作（供全局 ⌘/Ctrl+Z 消费）。
 * 与 Toast 上的「撤销」按钮共用同一条闭包（once 语义由调用方保证），
 * 4 秒窗口期与 Toast 存活时间一致，超时自动失效。
 */
export interface UndoEntry {
  label: string
  run: () => void
  expires: number
}

let current: UndoEntry | null = null

export function registerUndo(label: string, run: () => void, ttlMs = 4000): void {
  current = { label, run, expires: Date.now() + ttlMs }
}

export function consumeUndo(): UndoEntry | null {
  if (!current || Date.now() > current.expires) {
    current = null
    return null
  }
  const e = current
  current = null
  return e
}
