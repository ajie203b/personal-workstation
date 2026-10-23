/** 忽略旧设置中的未知项或重复项，新工具追加到末尾。 */
export function orderTools<T extends { to: string }>(tools: T[], saved: unknown): T[] {
  const remaining = new Map(tools.map(tool => [tool.to, tool]))
  const ordered: T[] = []
  if (Array.isArray(saved)) for (const id of saved) {
    const tool = remaining.get(id)
    if (tool) { ordered.push(tool); remaining.delete(id) }
  }
  return [...ordered, ...remaining.values()]
}
