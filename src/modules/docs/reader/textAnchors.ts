import type { AnnotationTextAnchor } from '@/db/db'

/** DOM Range 不受鼠标拖选方向影响；每一块保存实际相交部分及文本偏移。 */
export function collectTextAnchors(range: Range, roots: readonly (HTMLElement | null)[]): AnnotationTextAnchor[] {
  const anchors: AnnotationTextAnchor[] = []
  roots.forEach((root, blockIdx) => {
    if (!root || !range.intersectsNode(root)) return
    const part = document.createRange()
    part.selectNodeContents(root)
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset)
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset)
    const text = part.toString()
    if (!text.trim()) return
    const prefix = document.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(part.startContainer, part.startOffset)
    const start = prefix.toString().length
    anchors.push({ blockIdx, start, end: start + text.length, text })
  })
  return anchors
}

/** 逐文本节点包裹，不改变段落、列表或内联元素结构。旧批注兼容浏览器插入的段落换行。 */
export function wrapText(
  root: HTMLElement | readonly HTMLElement[], text: string, annId: string, color: string,
  anchor?: Pick<AnnotationTextAnchor, 'start' | 'end'>,
): boolean {
  const nodes: Text[] = []
  for (const element of root instanceof HTMLElement ? [root] : root) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  }
  const joined = nodes.map((node) => node.data).join('')
  let start = anchor && joined.slice(anchor.start, anchor.end) === text ? anchor.start : joined.indexOf(text)
  let end = start + text.length
  if (start < 0) {
    // Selection.toString() 有段落换行，DOM 文本节点未必有；只用于兼容旧的摘录定位。
    const positions: number[] = []
    let compact = ''
    for (let i = 0; i < joined.length; i++) {
      if (/\s/.test(joined[i])) continue
      compact += joined[i]
      positions.push(i)
    }
    const needle = text.replace(/\s/g, '')
    const index = needle ? compact.indexOf(needle) : -1
    if (index < 0) return false
    start = positions[index]
    end = positions[index + needle.length - 1] + 1
  }
  const targets: { node: Text; start: number; end: number }[] = []
  let consumed = 0
  for (const node of nodes) {
    const nodeStart = consumed
    consumed += node.data.length
    if (consumed <= start || nodeStart >= end) continue
    targets.push({ node, start: Math.max(0, start - nodeStart), end: Math.min(node.data.length, end - nodeStart) })
  }
  const formulas = new Set<Element>()
  for (const target of targets.reverse()) {
    if (!target.node.isConnected || !target.node.data.slice(target.start, target.end).trim()) continue
    const parent = target.node.parentElement
    const formula = parent?.closest('.katex') ?? parent?.closest('math')
    if (formula && formulas.has(formula)) continue
    const range = document.createRange()
    // MathML structure and KaTeX's paired visual/accessibility trees are atomic.
    if (formula) { formulas.add(formula); range.selectNode(formula) }
    else {
      range.setStart(target.node, target.start)
      range.setEnd(target.node, target.end)
    }
    const mark = document.createElement('mark')
    mark.className = `hl-${color}`
    mark.dataset.ann = annId
    range.surroundContents(mark)
  }
  return targets.length > 0
}
