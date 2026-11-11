export interface LocalScrollPosition {
  block: number
  offset: number
  progress: number
}

export function captureLocalPosition(view: HTMLElement, body?: Element | null): LocalScrollPosition {
  const top = view.getBoundingClientRect().top
  const blocks = Array.from(body?.children ?? [])
  const block = blocks.findIndex(el => el.getBoundingClientRect().bottom > top)
  const rect = blocks[block]?.getBoundingClientRect()
  return {
    block,
    offset: rect ? (top - rect.top) / Math.max(1, rect.height) : 0,
    progress: view.scrollTop / Math.max(1, view.scrollHeight - view.clientHeight),
  }
}

export function restoreLocalPosition(view: HTMLElement, position: LocalScrollPosition, body?: Element | null) {
  const rect = body?.children[position.block]?.getBoundingClientRect()
  view.scrollTop = rect
    ? view.scrollTop + rect.top - view.getBoundingClientRect().top + position.offset * rect.height
    : position.progress * Math.max(0, view.scrollHeight - view.clientHeight)
}
