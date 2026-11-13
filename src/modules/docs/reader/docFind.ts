import type { NormRect } from '../pdf/pdfRects'
import { collectPageRects } from '../pdf/pdfRects'

const MAX_MATCHES = 2000
const HAN_RE = /[\u4e00-\u9fff]/
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

export interface TextSegment {
  node: Text
  start: number
  end: number
}

/**
 * Collapse whitespace runs to a single space (or drop them between adjacent CJK
 * characters to tolerate pdf.js kerning splits), keeping a character map back to
 * indices in `raw`.
 */
export function normalizeForFind(raw: string): { normalized: string; map: number[] } {
  let normalized = ''
  const map: number[] = []
  let i = 0
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      const wsStart = i
      while (i < raw.length && /\s/.test(raw[i])) i++
      const prev = wsStart > 0 ? raw[wsStart - 1] : ''
      const next = i < raw.length ? raw[i] : ''
      if (normalized.length > 0 && i < raw.length && !(HAN_RE.test(prev) && HAN_RE.test(next))) {
        normalized += ' '
        map.push(wsStart)
      }
      continue
    }
    const lower = raw[i].toLowerCase()
    for (let k = 0; k < lower.length; k++) {
      normalized += lower[k]
      map.push(i)
    }
    i++
  }
  return { normalized, map }
}

export function normalizeQuery(query: string): string {
  return normalizeForFind(query.trim()).normalized.trim()
}

export function findRangesInText(raw: string, query: string): { start: number; end: number }[] {
  const needle = normalizeQuery(query)
  if (!needle) return []
  const { normalized, map } = normalizeForFind(raw)
  if (!normalized || needle.length > normalized.length) return []
  const out: { start: number; end: number }[] = []
  let from = 0
  while (out.length < MAX_MATCHES) {
    const idx = normalized.indexOf(needle, from)
    if (idx === -1) break
    const start = map[idx]
    const end = map[idx + needle.length - 1] + 1
    out.push({ start, end })
    from = idx + needle.length
  }
  return out
}

export function countMatchesInText(raw: string, query: string): number {
  return findRangesInText(raw, query).length
}

function collectDomText(root: Element, skipSelector: string, blockBreaks: boolean): { joined: string; segments: TextSegment[] } {
  let joined = ''
  let offset = 0
  const segments: TextSegment[] = []

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data
      if (data) {
        segments.push({ node: node as Text, start: offset, end: offset + data.length })
        joined += data
        offset += data.length
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (skipSelector && el.matches(skipSelector)) return
    if (el.tagName === 'BR') {
      joined += '\n'
      offset += 1
      return
    }
    for (const child of Array.from(el.childNodes)) walk(child)
    if (blockBreaks && el !== root && BLOCK_TAGS.has(el.tagName)) {
      joined += '\n'
      offset += 1
    }
  }

  walk(root)
  return { joined, segments }
}

export function clearFindMarks(roots: Element | null | readonly (Element | null)[]): void {
  const list = roots instanceof Element ? [roots] : roots ? Array.from(roots) : []
  for (const root of list) {
    if (!root) continue
    root.querySelectorAll('mark[data-find]').forEach((mark) => {
      const parent = mark.parentNode
      if (!parent) return
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
      mark.remove()
      parent.normalize()
    })
  }
}

export function highlightDomMatches(
  roots: readonly (HTMLElement | null)[],
  query: string,
): { total: number; matchRoots: number[] } {
  clearFindMarks(roots)
  if (!normalizeQuery(query)) return { total: 0, matchRoots: [] }

  let matchIdx = 0
  const matchRoots: number[] = []
  const wraps: { node: Text; start: number; end: number; matchIdx: number }[] = []

  roots.forEach((root, rootIdx) => {
    if (!root || matchIdx >= MAX_MATCHES) return
    const { joined, segments } = collectDomText(root, 'script,style,math,.katex-mathml', true)
    const ranges = findRangesInText(joined, query)
    for (const r of ranges) {
      if (matchIdx >= MAX_MATCHES) break
      const currentIdx = matchIdx++
      matchRoots.push(rootIdx)
      for (const seg of segments) {
        if (seg.end <= r.start || seg.start >= r.end) continue
        const s = Math.max(0, r.start - seg.start)
        const e = Math.min(seg.node.data.length, r.end - seg.start)
        if (s < e) wraps.push({ node: seg.node, start: s, end: e, matchIdx: currentIdx })
      }
    }
  })

  for (const w of wraps.reverse()) {
    if (!w.node.parentNode) continue
    const range = document.createRange()
    range.setStart(w.node, w.start)
    range.setEnd(w.node, w.end)
    const mark = document.createElement('mark')
    mark.className = 'find-hit'
    mark.dataset.find = String(w.matchIdx)
    range.surroundContents(mark)
  }

  return { total: matchIdx, matchRoots }
}

export function setActiveFindMark(container: Element | null, activeIdx: number): HTMLElement | null {
  if (!container) return null
  container.querySelectorAll('mark[data-find-active]').forEach((m) => {
    m.removeAttribute('data-find-active')
    m.classList.remove('find-hit-active')
  })
  if (activeIdx < 0) return null
  const hits = Array.from(container.querySelectorAll<HTMLElement>(`mark[data-find="${activeIdx}"]`))
  for (const h of hits) {
    h.dataset.findActive = 'true'
    h.classList.add('find-hit-active')
  }
  return hits[0] ?? null
}

/** Measure normalized bounding boxes of every query match inside a rendered PDF `.textLayer`. */
export function collectTextLayerFindRects(
  textLayer: Element,
  wrapperRect: DOMRect,
  query: string,
): NormRect[][] {
  if (!normalizeQuery(query) || !wrapperRect.width || !wrapperRect.height) return []
  const { joined, segments } = collectDomText(textLayer, 'script,style', false)
  const ranges = findRangesInText(joined, query)
  const out: NormRect[][] = []
  for (const r of ranges) {
    let first: { node: Text; off: number } | null = null
    let last: { node: Text; off: number } | null = null
    for (const seg of segments) {
      if (seg.end <= r.start || seg.start >= r.end) continue
      if (!first) first = { node: seg.node, off: Math.max(0, r.start - seg.start) }
      last = { node: seg.node, off: Math.min(seg.node.data.length, r.end - seg.start) }
    }
    if (!first || !last) continue
    const domRange = document.createRange()
    domRange.setStart(first.node, first.off)
    domRange.setEnd(last.node, last.off)
    out.push(collectPageRects(domRange, wrapperRect))
  }
  return out
}
