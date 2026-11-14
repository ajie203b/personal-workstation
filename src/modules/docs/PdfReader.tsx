import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { getDocBlob, saveScrollAndProgress } from '@/db/docs'
import { openExternal } from '@/lib/links'
import { usePinch } from '@/lib/usePinch'
import type { Annotation, DocSettings } from '@/db/db'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  cropPdfCanvas,
  mergeLineRects,
  readPageSelection,
  type NormRect,
  type PdfSelectionInfo,
} from './pdf/pdfRects'
import { PageAnnotationsOverlay, PageFindOverlay, SelectionLayer } from './pdf/PdfPageOverlays'
import {
  canUsePdfSpread,
  computePdfDisplayWidth,
  computePdfFitWidth,
  computePdfLayout,
  computePdfRenderDpr,
  computeTrimTransform,
  findRowAtY,
} from './pdf/pdfLayout'
import { collectTextLayerFindRects, countMatchesInText, normalizeQuery } from './reader/docFind'
import type { FilterAnnotationsArgs, OnItemClickArgs } from 'react-pdf/dist/shared/types.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PdfSelectionInfo }

export interface TocItem {
  level: number
  title: string
  page: number
  anchor?: string
}

interface Props {
  hash: string
  localBlob?: Blob
  localScrollProgress?: number
  settings: DocSettings
  annotations: Annotation[]
  jump: { anchor: string; hl?: string; ts: number } | null
  onSelection: (sel: PdfSelectionInfo | null) => void
  /** 区域截图模式（M2.5）：开启时在页面上拖拽框选 */
  shotMode?: boolean
  onShot?: (shot: { page: number; rects: { x: number; y: number; w: number; h: number }[]; img: string }) => void
  onProgress: (page: number, pct: number) => void
  onRestored: () => void
  onLoaded: (numPages: number, outline: TocItem[]) => void
  scrollRef: React.RefObject<HTMLDivElement>
  initialTarget: { page: number; offsetRatio: number } | null
  /** 双指缩放提交（页宽倍数，1 = 适配阅读区） */
  onZoom?: (zoom: number) => void
  findQuery?: string
  findActive?: number
  onFindState?: (state: { total: number; searching: boolean }) => void
  selectedAnnId?: string | null
  onSelectAnnotation?: (sel: { ann: Annotation; popover: { left: number; y: number; below: boolean } } | null) => void
}

// 当前页前后各渲染几页：手机上一个 canvas 就是几 MB（dpr 3 时 1098×1420），
// 5 页常驻在低内存机型上会把 WebView 拖到卡死；窄屏只留前后各 1 页。
const RENDER_WINDOW_WIDE = 2
const RENDER_WINDOW_NARROW = 1
// PDF 画布按 dpr 渲染；手机上 dpr 3 会把单页画布放大到 2.25 倍面积，封顶 2 足够清晰
const PDF_DPR = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1

// 注意：必须保持同一引用 —— 内联对象会让 react-pdf 认为 options 变化，
// 用已被 transfer（detached）的 ArrayBuffer 重新加载而崩溃
const PDF_OPTIONS = {
  cMapUrl: 'pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'pdfjs/standard_fonts/',
}

function filterPdfLinkAnnotations({ annotations }: FilterAnnotationsArgs) {
  return annotations.filter((a) => {
    if (a.subtype !== 'Link') return false
    const item = a as { url?: string; unsafeUrl?: string }
    if (item.url) return /^(https?:|mailto:|tel:)/i.test(item.url)
    if (item.unsafeUrl) return false
    return true
  })
}

/** PDF 阅读器：精确占位 + 窗口渲染 + 文本层划词 + 区域截图 + 暗色反色 */
export function PdfReader({
  hash, localBlob, localScrollProgress, settings, annotations, jump, onSelection, shotMode, onShot, onProgress, onRestored, onLoaded, scrollRef, initialTarget, onZoom, findQuery = '', findActive = 0, onFindState, selectedAnnId, onSelectAnnotation,
}: Props) {
  const [data, setData] = useState<Blob | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [ratios, setRatios] = useState<number[]>([]) // 每页 高/宽
  const [containerW, setContainerW] = useState(0)
  // 与排版弹层一致：<768 视为手机，按屏宽适配并隐藏宽度设置；桌面窗口收起侧栏后仍保留滑块
  const [phoneLayout, setPhoneLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  const [center, setCenter] = useState(1) // 当前视口中心页
  const [flashId, setFlashId] = useState<string | null>(null)
  // 截图框选状态
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null)
  // 缩放：手势中直接改外层 transform（不触发 React 重渲染），松手再改页宽、重渲染成清晰的
  const zoom = settings.zoom ?? 1
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const liveZoomRef = useRef(zoom)
  const transformRef = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<{ ratio: number } | null>(null)
  const lastScrollTop = useRef(0)
  const restoredRef = useRef(false)
  const lastJumpTs = useRef(0)
  const lastWriteRef = useRef(0)
  const lastReportedPct = useRef(-1)
  /** 顶层细进度条：文档解析 + 页宽高比测量阶段才有意义，量完就收起 */
  const [loadPct, setLoadPct] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** 已画完的页：用来做「模糊 → 清晰」的入场（画布出来前先给一块糊的占位） */
  const [drawn, setDrawn] = useState<Set<number>>(() => new Set())
  const pdfProxyRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const pageTextCacheRef = useRef<Map<number, Promise<string>>>(new Map())
  const pageWrappersRef = useRef<Map<number, HTMLElement>>(new Map())
  const [textReadyTick, setTextReadyTick] = useState(0)
  const onRenderTextLayerSuccess = useCallback(() => setTextReadyTick((tick) => tick + 1), [])
  const [findMatches, setFindMatches] = useState<{ page: number; pageMatchIdx: number }[]>([])
  const [pageFindRects, setPageFindRects] = useState<Map<number, NormRect[][]>>(() => new Map())
  const pageFindRectsRef = useRef(pageFindRects)
  pageFindRectsRef.current = pageFindRects
  const lastScrolledFindRef = useRef<{ query: string; active: number; count: number } | null>(null)
  const pendingRefineMatchRef = useRef<{ page: number; pageMatchIdx: number } | null>(null)

  useEffect(() => {
    let alive = true
    pdfProxyRef.current = null
    pageTextCacheRef.current.clear()
    setData(null)
    void (localBlob ? Promise.resolve(localBlob) : getDocBlob(hash)).then(async (blob) => {
      if (!alive) return
      if (!blob) {
        setLoadError('找不到这个 PDF 的文件本体，可能已被系统清理。重新导入一份即可。')
        return
      }
      if (alive) setData(blob)
    })
    return () => { alive = false }
  }, [hash, localBlob, reloadKey])

  const spreadActive = canUsePdfSpread(settings.pdfSpread, containerW, phoneLayout)
  const trimmed = Boolean(settings.pdfTrimMargins)
  const fitW = computePdfFitWidth(containerW, phoneLayout, settings.widthPct, spreadActive)
  const dispW = computePdfDisplayWidth(fitW, zoom)
  const [rasterW, setRasterW] = useState(dispW)
  const prevDocHashRef = useRef(hash)
  useEffect(() => {
    if (prevDocHashRef.current !== hash || !numPages) {
      prevDocHashRef.current = hash
      setRasterW(dispW)
      return
    }
    if (dispW === rasterW) return
    const id = window.setTimeout(() => setRasterW(dispW), 160)
    return () => window.clearTimeout(id)
  }, [hash, numPages, dispW, rasterW])

  // 页宽很大时按比例降低画布 DPR，避免 2600px 宽、dpr2 的 canvas 把手机内存和渲染拖垮
  const renderDpr = computePdfRenderDpr(rasterW, PDF_DPR)
  const previewScale = rasterW > 0 ? dispW / rasterW : 1
  const { trimTransform, previewTransform } = computeTrimTransform(trimmed, previewScale)
  const pageH = useCallback(
    (i: number) => (ratios[i] ? Math.round(dispW * ratios[i]) : Math.round(dispW * 1.414)),
    [dispW, ratios],
  )
  const layoutMetrics = useMemo(
    () => computePdfLayout(numPages, ratios, dispW, spreadActive),
    [numPages, ratios, dispW, spreadActive],
  )
  const offsets = useRef<number[]>([])
  const layout = useCallback(() => {
    offsets.current = layoutMetrics.pageOffsets
    return layoutMetrics.totalHeight
  }, [layoutMetrics])

  usePinch(scrollRef, {
    onStart: () => {
      liveZoomRef.current = zoomRef.current
    },
    onScale: (ratio, mid) => {
      const next = Math.min(3, Math.max(0.5, zoomRef.current * ratio))
      liveZoomRef.current = next
      const p = next / zoomRef.current
      const box = transformRef.current
      const el = scrollRef.current
      if (!box || !el || Math.abs(p - 1) < 0.005) return
      const rect = el.getBoundingClientRect()
      const ox = mid.x - rect.left + el.scrollLeft
      const oy = mid.y - rect.top + el.scrollTop
      box.style.transformOrigin = `${ox}px ${oy}px`
      box.style.transform = `scale(${p})`
      box.style.willChange = 'transform'
    },
    onEnd: () => {
      const next = Math.round(liveZoomRef.current * 100) / 100
      const box = transformRef.current
      if (Math.abs(next - zoomRef.current) < 0.01) {
        if (box) { box.style.transform = ''; box.style.willChange = '' }
        return
      }
      const el = scrollRef.current
      if (el) {
        const max = el.scrollHeight - el.clientHeight
        zoomAnchor.current = { ratio: max > 0 ? el.scrollTop / max : 0 }
      }
      if (onZoom) {
        onZoom(next)
      } else if (box) {
        box.style.transform = ''
        box.style.willChange = ''
      }
    },
  })

  useLayoutEffect(() => {
    const box = transformRef.current
    if (box) {
      box.style.transform = ''
      box.style.transformOrigin = 'top center'
      box.style.willChange = ''
    }
    const el = scrollRef.current
    if (!el) return
    const anchor = zoomAnchor.current
    if (anchor) {
      zoomAnchor.current = null
      const max = el.scrollHeight - el.clientHeight
      el.scrollTop = Math.max(0, anchor.ratio * max)
    }
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  }, [dispW, scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !numPages) return
    let raf1 = 0
    let raf2 = 0
    const centerScroll = () => { el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2) }
    raf1 = requestAnimationFrame(() => {
      centerScroll()
      raf2 = requestAnimationFrame(centerScroll)
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [numPages, ratios, dispW, scrollRef])

  useLayoutEffect(() => {
    setDrawn(new Set())
  }, [rasterW])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setContainerW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setPhoneLayout(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const onLoad = useCallback(
    async (pdf: import('pdfjs-dist').PDFDocumentProxy) => {
      try {
        pdfProxyRef.current = pdf
        const n = pdf.numPages
        if (!n || n < 1) throw new Error('这份 PDF 里没有可显示的页面')
        const ratioOf = async (i: number) => {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: 1 })
          return vp.height / vp.width
        }
        const same = (a: number, b: number) => Math.abs(a - b) < 1e-3
        const allIdx = Array.from({ length: n }, (_, i) => i + 1)
        const probe = [...new Set([1, n, ...[0.25, 0.5, 0.75].map(fraction => Math.max(1, Math.round(n * fraction)))])].sort((a, b) => a - b)
        const prs = await Promise.all(probe.map(ratioOf))
        const commit = (rs: number[]) => {
          setNumPages(n)
          setRatios(rs)
        }
        const uniform = prs.every((r) => same(r, prs[0]))
        if (uniform) {
          commit(Array.from({ length: n }, () => prs[0]))
          const full = await Promise.all(allIdx.map(ratioOf))
          if (full.some((r) => !same(r, prs[0]))) commit(full)
        } else {
          commit(await Promise.all(allIdx.map(ratioOf)))
        }

        const outlineItems: TocItem[] = []
        try {
          const outline = await pdf.getOutline()
          const walk = async (items: Awaited<ReturnType<typeof pdf.getOutline>> | undefined, level: number) => {
            if (!items) return
            for (const it of items) {
              let pageNumber = 1
              try {
                let dest = it.dest
                if (typeof dest === 'string') dest = await pdf.getDestination(dest)
                if (Array.isArray(dest)) {
                  const ref = dest[0]
                  if (ref && typeof ref === 'object') pageNumber = (await pdf.getPageIndex(ref as never)) + 1
                }
              } catch {
                /* 无法解析的目录项 */
              }
              outlineItems.push({ level, title: it.title || '未命名', page: pageNumber })
              await walk(it.items as never, level + 1)
            }
          }
          await walk(outline, 0)
        } catch {
          /* 无大纲 */
        }
        setLoadPct(1)
        onLoaded(n, outlineItems)
      } catch (e) {
        setLoadError(e instanceof Error && e.message ? `解析失败：${e.message}` : '这份 PDF 解析失败，可能已损坏。')
      }
    },
    [onLoaded],
  )

  const onScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || !numPages) return
    layout()
    const top = container.scrollTop
    const maxScroll = container.scrollHeight - container.clientHeight
    const pct = maxScroll > 0 ? Math.min(1, top / maxScroll) : 0

    const probe = top + container.clientHeight * 0.3
    const rowIdx = findRowAtY(layoutMetrics.rows, probe)
    const row = layoutMetrics.rows[rowIdx]
    const currentPage = row?.pages[0] ?? 1
    const current = currentPage - 1
    setCenter(currentPage)
    const intPct = Math.round(pct * 100)
    if (intPct !== lastReportedPct.current) {
      lastReportedPct.current = intPct
      onProgress(currentPage, intPct / 100)
    }

    const delta = Math.abs(top - lastScrollTop.current)
    lastScrollTop.current = top
    const now = Date.now()
    if (now - lastWriteRef.current < 500) return
    lastWriteRef.current = now
    if (delta < 3000) {
      const pageTop = offsets.current[current] ?? 0
      const pageHpx = row?.height || pageH(current)
      const offsetRatio = pageHpx > 0 ? Math.min(1, Math.max(0, (probe - pageTop) / pageHpx)) : 0
      void saveScrollAndProgress(hash, top, { kind: 'pdf', page: currentPage, offsetRatio }, pct)
    } else {
      void saveScrollAndProgress(hash, top, null, pct)
    }
  }, [hash, numPages, onProgress, scrollRef, layout, layoutMetrics.rows, pageH])

  useLayoutEffect(() => {
    if (restoredRef.current || (!initialTarget && localScrollProgress == null) || !numPages || !ratios.length) return
    const container = scrollRef.current
    if (!container) return
    layout()
    if (initialTarget) {
      const pageTop = offsets.current[initialTarget.page - 1] ?? 0
      const h = pageH(initialTarget.page - 1)
      container.scrollTop = Math.max(0, pageTop + initialTarget.offsetRatio * h - container.clientHeight * 0.3)
    } else {
      container.scrollTop = (localScrollProgress ?? 0) * Math.max(0, container.scrollHeight - container.clientHeight)
    }
    restoredRef.current = true
    onRestored()
  }, [initialTarget, localScrollProgress, numPages, ratios, scrollRef, onRestored, layout, pageH])

  useEffect(() => {
    if (!jump || jump.ts === lastJumpTs.current || !numPages || !ratios.length) return
    lastJumpTs.current = jump.ts
    const container = scrollRef.current
    if (!container) return
    const m = jump.anchor.match(/^p(\d+)/)
    const target = m ? Math.min(numPages, Math.max(1, Number(m[1]))) : 1
    layout()
    container.scrollTo({ top: Math.max(0, (offsets.current[target - 1] ?? 0) - 12), behavior: 'smooth' })
    setCenter(target)
    if (jump.hl) {
      setFlashId(jump.hl)
      const t = setTimeout(() => setFlashId(null), 2200)
      return () => clearTimeout(t)
    }
  }, [jump, numPages, ratios, scrollRef, layout, pageH])

  const onPageMouseUp = useCallback(
    (page: number, wrapper: HTMLElement) => {
      onSelectAnnotation?.(null)
      onSelection(readPageSelection(page, wrapper, scrollRef.current))
    },
    [onSelection, onSelectAnnotation, scrollRef],
  )

  useEffect(() => {
    if (shotMode) onSelectAnnotation?.(null)
  }, [shotMode, onSelectAnnotation])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        const node = sel?.anchorNode
        const pageEl = sel && !sel.isCollapsed
          ? ((node instanceof Element ? node : node?.parentElement)?.closest('[data-page]') as HTMLElement | null)
          : null
        onSelection(pageEl ? readPageSelection(Number(pageEl.dataset.page), pageEl, scrollRef.current) : null)
      }, 250)
    }
    document.addEventListener('selectionchange', debounced)
    document.addEventListener('touchend', debounced)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', debounced)
      document.removeEventListener('touchend', debounced)
    }
  }, [onSelection, scrollRef])

  const onShotMouseDown = useCallback((e: React.MouseEvent, page: number, wrapper: HTMLElement) => {
    if (!shotMode) return
    e.preventDefault()
    const r = wrapper.getBoundingClientRect()
    setDrag({ page, x0: (e.clientX - r.left) / r.width, y0: (e.clientY - r.top) / r.height, x1: (e.clientX - r.left) / r.width, y1: (e.clientY - r.top) / r.height })
  }, [shotMode])

  const onShotMouseMove = useCallback((e: React.MouseEvent, page: number, wrapper: HTMLElement) => {
    setDrag((d) => {
      if (!d || d.page !== page) return d
      const r = wrapper.getBoundingClientRect()
      return { ...d, x1: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y1: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
    })
  }, [])

  const onShotMouseUp = useCallback((_e: React.MouseEvent, page: number, wrapper: HTMLElement) => {
    if (!shotMode || !drag || drag.page !== page) return
    const x = Math.min(drag.x0, drag.x1)
    const y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0)
    const h = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    if (w < 0.02 || h < 0.02) return
    const img = cropPdfCanvas(wrapper, { x, y, w, h })
    if (img && onShot) {
      onShot({ page, rects: [{ x, y, w, h }], img })
    }
    window.getSelection()?.removeAllRanges()
  }, [shotMode, drag, onShot])

  const [pageDraft, setPageDraft] = useState<string | null>(null)
  const renderWindow = containerW > 0 && containerW < 768 ? RENDER_WINDOW_NARROW : RENDER_WINDOW_WIDE
  const lo = Math.max(1, center - renderWindow - (spreadActive ? 1 : 0))
  const hi = Math.min(numPages, center + renderWindow + (spreadActive ? 1 : 0))
  const dark = settings.theme === 'night' || settings.theme === 'dusk'

  const scrollToPdfPage = useCallback((pageNumber: number) => {
    const container = scrollRef.current
    if (!container || !numPages || !ratios.length) return
    const target = Math.min(numPages, Math.max(1, pageNumber))
    layout()
    container.scrollTo({ top: Math.max(0, (offsets.current[target - 1] ?? 0) - 12), behavior: 'smooth' })
    setCenter(target)
  }, [numPages, ratios.length, layout, scrollRef])

  const onPdfItemClick = useCallback(({ pageNumber }: OnItemClickArgs) => {
    if (shotMode) return
    if (pageNumber) scrollToPdfPage(pageNumber)
  }, [shotMode, scrollToPdfPage])

  const onFindStateRef = useRef(onFindState)
  onFindStateRef.current = onFindState

  const readPageText = useCallback((pdf: import('pdfjs-dist').PDFDocumentProxy, pageNumber: number) => {
    const cache = pageTextCacheRef.current
    const cached = cache.get(pageNumber)
    if (cached) return cached
    const text = pdf.getPage(pageNumber).then((page) => page.getTextContent()).then((content) =>
      content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join(''),
    ).catch(() => '')
    cache.set(pageNumber, text)
    return text
  }, [])

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
  }, [data, findQuery, numPages, readPageText])

  // 逐页扫描 PDF 文本并缓存，用于页内查找计数与跨页跳转
  useEffect(() => {
    const pdf = pdfProxyRef.current
    if (!normalizeQuery(findQuery) || !numPages || !pdf) {
      setFindMatches([])
      setPageFindRects(new Map())
      lastScrolledFindRef.current = null
      pendingRefineMatchRef.current = null
      onFindStateRef.current?.({ total: 0, searching: false })
      return
    }
    let alive = true
    onFindStateRef.current?.({ total: 0, searching: true })
    void (async () => {
      const hits: { page: number; pageMatchIdx: number }[] = []
      for (let p = 1; p <= numPages; p++) {
        if (!alive) return
        if (pdfProxyRef.current !== pdf) return
        const text = await readPageText(pdf, p)
        const count = countMatchesInText(text, findQuery)
        for (let k = 0; k < count; k++) hits.push({ page: p, pageMatchIdx: k })
        if (p % 15 === 0) await new Promise<void>((r) => setTimeout(r, 0))
      }
      if (!alive) return
      setFindMatches(hits)
      onFindStateRef.current?.({ total: hits.length, searching: false })
    })()
    return () => { alive = false }
  }, [data, findQuery, numPages, readPageText])

  // 为渲染窗口内含命中的页面计算精确高亮矩形
  useEffect(() => {
    if (!normalizeQuery(findQuery) || !findMatches.length) {
      setPageFindRects((prev) => (prev.size ? new Map() : prev))
      return
    }
    const pagesWithHits = new Set<number>()
    for (const m of findMatches) if (m.page >= lo && m.page <= hi) pagesWithHits.add(m.page)
    const next = new Map<number, NormRect[][]>()
    for (const p of pagesWithHits) {
      const wrapper = pageWrappersRef.current.get(p)
      const textLayer = wrapper?.querySelector('.textLayer')
      if (!wrapper || !textLayer) continue
      const rects = collectTextLayerFindRects(textLayer, wrapper.getBoundingClientRect(), findQuery)
      if (rects.length) next.set(p, rects)
    }
    setPageFindRects(next)
  }, [findQuery, findMatches, lo, hi, dispW, textReadyTick])

  const activeFindMatch = findMatches.length
    ? findMatches[Math.min(Math.max(0, findActive), findMatches.length - 1)]
    : null

  // 切换到新命中处：先滚到目标页，等 textLayer 算好矩形后再微调到该行
  useEffect(() => {
    if (!findMatches.length || !numPages || !ratios.length) return
    const idx = Math.min(Math.max(0, findActive), findMatches.length - 1)
    const prev = lastScrolledFindRef.current
    if (prev && prev.query === findQuery && prev.active === idx && prev.count === findMatches.length) return
    lastScrolledFindRef.current = { query: findQuery, active: idx, count: findMatches.length }
    const match = findMatches[idx]
    const container = scrollRef.current
    if (!container) return
    layout()
    const pageTop = offsets.current[match.page - 1] ?? 0
    const exactRect = pageFindRectsRef.current.get(match.page)?.[match.pageMatchIdx]?.[0]
    if (exactRect) {
      pendingRefineMatchRef.current = null
      const y = pageTop + exactRect.y * pageH(match.page - 1) - container.clientHeight * 0.35
      container.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    } else {
      pendingRefineMatchRef.current = { page: match.page, pageMatchIdx: match.pageMatchIdx }
      container.scrollTo({ top: Math.max(0, pageTop - 12), behavior: 'smooth' })
      setCenter(match.page)
    }
  }, [findQuery, findActive, findMatches, numPages, ratios.length, layout, pageH, scrollRef])

  useEffect(() => {
    const pending = pendingRefineMatchRef.current
    if (!pending) return
    const exactRect = pageFindRects.get(pending.page)?.[pending.pageMatchIdx]?.[0]
    if (!exactRect) return
    pendingRefineMatchRef.current = null
    const container = scrollRef.current
    if (!container) return
    layout()
    const pageTop = offsets.current[pending.page - 1] ?? 0
    const y = pageTop + exactRect.y * pageH(pending.page - 1) - container.clientHeight * 0.35
    container.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
  }, [pageFindRects, layout, pageH, scrollRef])

  const annRects = useMemo(() => {
    const m = new Map<string, NormRect[]>()
    for (const a of annotations) {
      if (!a.rects?.length) continue
      m.set(a.id, mergeLineRects(a.rects, ratios[(a.page ?? 1) - 1] ?? 1.414))
    }
    return m
  }, [annotations, ratios])

  const annotationsByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>()
    for (const a of annotations) {
      if (!a.page || !a.rects) continue
      const list = m.get(a.page) ?? []
      list.push(a)
      m.set(a.page, list)
    }
    return m
  }, [annotations])

  return (
    <div className="relative h-full">
      {(loadPct < 1 || data === null) && !loadError && (
        <div className="absolute inset-x-0 top-0 z-20 h-[2px] bg-transparent pointer-events-none" aria-hidden>
          <div
            className="h-full bg-primary origin-left"
            style={{
              width: `${loadPct < 0.08 ? 8 : loadPct * 100}%`,
              transition: 'width 240ms cubic-bezier(.22,.61,.36,1)',
              boxShadow: '0 0 8px color-mix(in srgb, var(--primary) 60%, transparent)',
            }}
          />
        </div>
      )}

      {loadError && (
        <div className="h-full grid place-items-center px-6">
          <div className="max-w-sm text-center">
            <p className="text-[15px] font-semibold">这份 PDF 打不开</p>
            <p className="text-[13px] text-on-surface-2 mt-1.5 leading-relaxed">{loadError}</p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => { setLoadError(null); setLoadPct(0); setData(null); setReloadKey((k) => k + 1) }}
                className="h-9 px-4 rounded-[10px] bg-primary text-on-primary text-[13px] font-medium cursor-pointer"
              >
                重试
              </button>
              <Link to="/docs" className="h-9 px-4 rounded-[10px] border border-outline text-[13px] leading-9 text-on-surface-2 hover:text-on-surface">
                返回文档库
              </Link>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={(e) => {
          const a = (e.target as Element).closest?.('.annotationLayer a[href]')
          if (!a) return
          const href = a.getAttribute('href') ?? ''
          if (!href || href.startsWith('#')) {
            e.preventDefault()
          } else if (/^(https?:|mailto:|tel:)/i.test(href)) {
            e.preventDefault()
            openExternal(href)
          } else {
            e.preventDefault()
          }
        }}
        style={{ touchAction: 'pan-x pan-y', display: loadError ? 'none' : undefined }}
        className="h-full overflow-auto overscroll-contain bg-surface-3/45"
      >
        <div ref={transformRef} style={{ transformOrigin: 'top center', backfaceVisibility: 'hidden' }}>
          <Document
            key={reloadKey}
            file={data ?? undefined}
            onLoadSuccess={onLoad}
            onItemClick={onPdfItemClick}
            onLoadProgress={({ loaded, total }) => {
              if (total > 0) setLoadPct(Math.min(0.98, loaded / total))
            }}
            onLoadError={(e) => setLoadError(e?.message || '文件可能已损坏，或格式不受支持')}
            loading={<div className="grid place-items-center h-40 text-on-surface-2 text-[13px]">正在载入 PDF…</div>}
            error={null}
            className="flex flex-col items-center py-5 gap-4 min-w-full w-max"
            options={PDF_OPTIONS}
          >
        {numPages > 0 &&
          layoutMetrics.rows.map((row, rowIdx) => (
            <div key={rowIdx} className="flex items-start justify-center gap-3 mx-auto">
              {row.pages.map((p) => {
                const inWindow = p >= lo && p <= hi
                const pageAnns = annotationsByPage.get(p)
                const findRects = pageFindRects.get(p)
                const activeIdxOnPage = activeFindMatch?.page === p ? activeFindMatch.pageMatchIdx : -1
                const slotH = pageH(p - 1)
                const rasterH = ratios[p - 1] ? Math.round(rasterW * ratios[p - 1]) : Math.round(rasterW * 1.414)
                return (
                  <div key={p} className="flex flex-col items-center gap-1">
                    <div
                      data-page-slot={p}
                      style={{ width: dispW, height: slotH }}
                      className={`relative rounded-[6px] overflow-hidden bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_44px_-26px_rgba(0,0,0,0.4)] ${dark ? 'pdf-dark' : ''}`}
                    >
                      <div
                        className="w-full h-full origin-center"
                        style={trimTransform ? { transform: trimTransform } : undefined}
                      >
                        <div
                          data-page={p}
                          ref={(el) => {
                            if (el) pageWrappersRef.current.set(p, el)
                            else pageWrappersRef.current.delete(p)
                          }}
                          style={{
                            width: rasterW,
                            height: rasterH,
                            transform: previewTransform,
                            transformOrigin: 'top left',
                            filter: inWindow && !drawn.has(p) ? 'blur(10px)' : undefined,
                            opacity: inWindow && !drawn.has(p) ? 0.55 : 1,
                            transition: 'filter 260ms ease-out, opacity 260ms ease-out',
                          }}
                          className={`relative ${shotMode ? 'cursor-crosshair select-none' : ''}`}
                          onMouseUp={(e) => (shotMode ? onShotMouseUp(e, p, e.currentTarget) : onPageMouseUp(p, e.currentTarget))}
                          onMouseDown={(e) => onShotMouseDown(e, p, e.currentTarget)}
                          onMouseMove={(e) => onShotMouseMove(e, p, e.currentTarget)}
                        >
                          {inWindow ? (
                            <Page
                              pageNumber={p}
                              width={rasterW}
                              devicePixelRatio={renderDpr}
                              renderTextLayer
                              renderAnnotationLayer={!shotMode}
                              filterAnnotations={filterPdfLinkAnnotations}
                              loading=""
                              onRenderTextLayerSuccess={onRenderTextLayerSuccess}
                              onRenderSuccess={() => setDrawn((s) => (s.has(p) ? s : new Set(s).add(p)))}
                            />
                          ) : null}
                          {drag && drag.page === p && (
                            <div
                              className="absolute border-2 border-primary bg-primary/10 pointer-events-none z-10"
                              style={{
                                left: `${Math.min(drag.x0, drag.x1) * 100}%`,
                                top: `${Math.min(drag.y0, drag.y1) * 100}%`,
                                width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
                                height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
                              }}
                            />
                          )}
                          {findRects && <PageFindOverlay matches={findRects} activeMatchIdx={activeIdxOnPage} />}
                          {pageAnns && (
                            <PageAnnotationsOverlay
                              annotations={pageAnns}
                              annRects={annRects}
                              flashId={flashId}
                              interactive={!shotMode && !!onSelectAnnotation}
                              selectedId={selectedAnnId}
                              onSelectAnn={(ann, rect) => {
                                const below = rect.top < 120
                                onSelectAnnotation?.({
                                  ann,
                                  popover: { left: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below },
                                })
                              }}
                            />
                          )}
                          {!shotMode && <SelectionLayer page={p} />}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10.5px] tabular-nums tracking-[0.04em] text-on-surface-2/80 select-none mt-0.5">
                      {p} / {numPages}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
          </Document>
        </div>
      </div>
      {numPages > 0 && (
        <div className="pdf-floating-pill absolute bottom-3 left-3 z-10 flex items-center gap-0.5 h-8 px-1.5 rounded-full bg-surface/95 border border-outline shadow-sm text-[12px] text-on-surface-2 backdrop-blur">
          <button
            type="button"
            aria-label="上一页"
            disabled={center <= 1}
            onClick={() => scrollToPdfPage(center - 1)}
            className="grid place-items-center w-6 h-6 rounded-full hover:bg-surface-3 disabled:opacity-35 cursor-pointer disabled:cursor-default"
          >
            <ChevronLeft size={14} />
          </button>
          <form
            className="flex items-center gap-1 px-1"
            onSubmit={(e) => {
              e.preventDefault()
              const raw = pageDraft ?? String(center)
              const n = Number(raw)
              setPageDraft(null)
              if (Number.isFinite(n) && n >= 1) scrollToPdfPage(Math.min(numPages, Math.round(n)))
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              aria-label="跳转页码"
              value={pageDraft ?? String(center)}
              onFocus={(e) => {
                setPageDraft(String(center))
                e.currentTarget.select()
              }}
              onChange={(e) => setPageDraft(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => {
                if (pageDraft !== null && pageDraft !== '') {
                  const n = Number(pageDraft)
                  if (Number.isFinite(n) && n >= 1) scrollToPdfPage(Math.min(numPages, Math.round(n)))
                }
                setPageDraft(null)
              }}
              className="w-8 bg-transparent text-center tabular-nums text-on-surface font-medium outline-none focus:bg-surface-3/70 rounded"
            />
            <span className="tabular-nums text-on-surface-2/80 select-none">/ {numPages}</span>
          </form>
          <button
            type="button"
            aria-label="下一页"
            disabled={center >= numPages}
            onClick={() => scrollToPdfPage(center + 1)}
            className="grid place-items-center w-6 h-6 rounded-full hover:bg-surface-3 disabled:opacity-35 cursor-pointer disabled:cursor-default"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      {zoom !== 1 && (
        <button
          onClick={() => onZoom?.(1)}
          className="pdf-floating-pill absolute bottom-3 right-3 z-10 h-8 px-3 rounded-full bg-surface/95 border border-outline shadow-sm text-[12px] text-on-surface-2 backdrop-blur cursor-pointer"
        >
          {Math.round(zoom * 100)}% · 重置
        </button>
      )}
    </div>
  )
}
