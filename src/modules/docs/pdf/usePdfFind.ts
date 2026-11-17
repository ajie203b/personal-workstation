import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { collectTextLayerFindRects, countMatchesInText, normalizeQuery } from '../reader/docFind'
import type { NormRect } from './pdfRects'

interface FindMatch {
  page: number
  pageMatchIdx: number
}

interface SearchResult {
  pdf: PDFDocumentProxy
  query: string
  matches: FindMatch[]
}

const EMPTY_RECTS = new Map<number, NormRect[][]>()

interface Options {
  data: Blob | null
  pdfProxyRef: RefObject<PDFDocumentProxy>
  pageTextCacheRef: MutableRefObject<Map<number, Promise<string>>>
  numPages: number
  hasPageRatios: boolean
  lo: number
  hi: number
  dispW: number
  findQuery: string
  findActive: number
  onFindState?: (state: { total: number; searching: boolean }) => void
  scrollRef: RefObject<HTMLDivElement>
  pageOffsets: readonly number[]
  pageH: (idx: number) => number
  setCenter: (page: number) => void
}

export function usePdfFind({
  data, pdfProxyRef, pageTextCacheRef, numPages, hasPageRatios, lo, hi, dispW,
  findQuery, findActive, onFindState, scrollRef, pageOffsets, pageH, setCenter,
}: Options) {
  const pageWrappersRef = useRef<Map<number, HTMLElement>>(new Map())
  const [textReadyTick, setTextReadyTick] = useState(0)
  const onRenderTextLayerSuccess = useCallback(() => setTextReadyTick((tick) => tick + 1), [])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [overlay, setOverlay] = useState<{ result: SearchResult; rects: Map<number, NormRect[][]> } | null>(null)
  const currentResult = result?.query === findQuery && result.pdf === pdfProxyRef.current ? result : null
  const pageFindRects = overlay?.result === currentResult ? overlay.rects : EMPTY_RECTS
  const lastScrolledFindRef = useRef<FindMatch | null>(null)
  const pendingRefineMatchRef = useRef<FindMatch | null>(null)

  const onFindStateRef = useRef(onFindState)
  onFindStateRef.current = onFindState

  const readPageText = useCallback((pdf: PDFDocumentProxy, pageNumber: number) => {
    const cache = pageTextCacheRef.current
    const cached = cache.get(pageNumber)
    if (cached) return cached
    const text = pdf.getPage(pageNumber).then((page) => page.getTextContent()).then((content) =>
      content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join(''),
    ).catch(() => '')
    cache.set(pageNumber, text)
    return text
  }, [pageTextCacheRef])

  useEffect(() => {
    const pdf = pdfProxyRef.current
    if (!data || !pdf || !numPages || normalizeQuery(findQuery) || !window.requestIdleCallback) return
    let active = true
    let pending = 0
    let nextPage = 1
    let reading = false
    const schedule = () => {
      if (!active || reading || pending || pdfProxyRef.current !== pdf || document.hidden) return
      while (pageTextCacheRef.current.has(nextPage)) nextPage++
      if (nextPage > pdf.numPages) return
      pending = window.requestIdleCallback(() => {
        pending = 0
        if (!active || pdfProxyRef.current !== pdf || document.hidden) return
        reading = true
        void readPageText(pdf, nextPage++).then(() => {
          reading = false
          schedule()
        })
      })
    }
    // 先让页面完成首屏绘制，再空闲时逐页读取；与搜索共享已缓存的请求。
    const start = window.setTimeout(schedule, 600)
    const onVisibility = () => {
      window.cancelIdleCallback(pending)
      pending = 0
      if (!document.hidden) schedule()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearTimeout(start)
      window.cancelIdleCallback(pending)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [data, findQuery, numPages, pageTextCacheRef, pdfProxyRef, readPageText])

  // 逐页扫描 PDF 文本并缓存，用于页内查找计数与跨页跳转
  useEffect(() => {
    const pdf = pdfProxyRef.current
    setResult(null)
    setOverlay(null)
    lastScrolledFindRef.current = null
    pendingRefineMatchRef.current = null
    if (!normalizeQuery(findQuery) || !numPages || !pdf) {
      onFindStateRef.current?.({ total: 0, searching: false })
      return
    }
    let alive = true
    onFindStateRef.current?.({ total: 0, searching: true })
    void (async () => {
      const matches: FindMatch[] = []
      for (let p = 1; p <= numPages; p++) {
        if (!alive || pdfProxyRef.current !== pdf) return
        const text = await readPageText(pdf, p)
        if (!alive || pdfProxyRef.current !== pdf) return
        const count = countMatchesInText(text, findQuery)
        for (let k = 0; k < count; k++) matches.push({ page: p, pageMatchIdx: k })
        if (p % 15 === 0) await new Promise<void>((r) => setTimeout(r, 0))
      }
      if (!alive || pdfProxyRef.current !== pdf) return
      setResult({ pdf, query: findQuery, matches })
      onFindStateRef.current?.({ total: matches.length, searching: false })
    })()
    return () => { alive = false }
  }, [data, findQuery, numPages, pdfProxyRef, readPageText])

  // 为渲染窗口内含命中的页面计算精确高亮矩形
  useEffect(() => {
    if (!currentResult?.matches.length) return
    const pagesWithHits = new Set<number>()
    for (const m of currentResult.matches) if (m.page >= lo && m.page <= hi) pagesWithHits.add(m.page)
    const rectsByPage = new Map<number, NormRect[][]>()
    for (const p of pagesWithHits) {
      const wrapper = pageWrappersRef.current.get(p)
      const textLayer = wrapper?.querySelector('.textLayer')
      if (!wrapper || !textLayer) continue
      const rects = collectTextLayerFindRects(textLayer, wrapper.getBoundingClientRect(), currentResult.query)
      if (rects.length) rectsByPage.set(p, rects)
    }
    setOverlay({ result: currentResult, rects: rectsByPage })
  }, [currentResult, lo, hi, dispW, textReadyTick])

  const findMatches = currentResult?.matches
  const activeFindMatch = findMatches?.length
    ? findMatches[Math.min(Math.max(0, findActive), findMatches.length - 1)]
    : null

  // 切换到新命中处：先滚到目标页，等 textLayer 算好矩形后再微调到该行
  useEffect(() => {
    const match = activeFindMatch
    if (!match || !numPages || !hasPageRatios || lastScrolledFindRef.current === match) return
    const container = scrollRef.current
    if (!container) return
    lastScrolledFindRef.current = match
    const pageTop = pageOffsets[match.page - 1] ?? 0
    const exactRect = pageFindRects.get(match.page)?.[match.pageMatchIdx]?.[0]
    if (exactRect) {
      pendingRefineMatchRef.current = null
      const y = pageTop + exactRect.y * pageH(match.page - 1) - container.clientHeight * 0.35
      container.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    } else {
      pendingRefineMatchRef.current = match
      container.scrollTo({ top: Math.max(0, pageTop - 12), behavior: 'smooth' })
      setCenter(match.page)
    }
  }, [activeFindMatch, numPages, hasPageRatios, pageFindRects, pageOffsets, pageH, scrollRef, setCenter])

  useEffect(() => {
    const pending = pendingRefineMatchRef.current
    if (!pending || pending !== activeFindMatch) return
    const exactRect = pageFindRects.get(pending.page)?.[pending.pageMatchIdx]?.[0]
    if (!exactRect) return
    pendingRefineMatchRef.current = null
    const container = scrollRef.current
    if (!container) return
    const pageTop = pageOffsets[pending.page - 1] ?? 0
    const y = pageTop + exactRect.y * pageH(pending.page - 1) - container.clientHeight * 0.35
    container.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
  }, [activeFindMatch, pageFindRects, pageOffsets, pageH, scrollRef])

  return { pageWrappersRef, onRenderTextLayerSuccess, pageFindRects, activeFindMatch }
}
