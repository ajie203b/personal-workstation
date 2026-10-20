import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { saveScrollAndProgress } from '@/db/docs'
import { usePinch } from '@/lib/usePinch'
import type { Annotation, DocSettings } from '@/db/db'
import { getDocBlob } from '@/db/docs'
import { cn } from '@/lib/cn'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 按行并块。pdf.js 文本层同一行会因字体切换产出互相覆盖的 span（整行一段，拉丁词与标点又单独成段），
 * Range.getClientRects() 因此拿到重叠矩形：半透明底色叠两处深浅不一，标点单独成段处还断开。
 * 规则：垂直重叠过半算同一行；同行内水平间隙小于 0.9 倍行高的并成一块——够吞下词间空格，不至于跨过双栏栏距。
 * aspect = 页高 / 页宽，把行高换算到与 x 同一量纲。
 */
function mergeLineRects(rects: NormRect[], aspect: number): NormRect[] {
  const out: NormRect[] = []
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let hit: NormRect | null = null
    let hitGap = Infinity
    for (const m of out) {
      const overlapY = Math.min(m.y + m.h, r.y + r.h) - Math.max(m.y, r.y)
      if (overlapY < Math.min(m.h, r.h) * 0.5) continue
      const gap = Math.max(m.x, r.x) - Math.min(m.x + m.w, r.x + r.w)
      if (gap < hitGap) {
        hitGap = gap
        hit = m
      }
    }
    if (hit && hitGap <= Math.max(hit.h, r.h) * aspect * 0.9) {
      const x = Math.min(hit.x, r.x)
      const y = Math.min(hit.y, r.y)
      const right = Math.max(hit.x + hit.w, r.x + r.w)
      const bottom = Math.max(hit.y + hit.h, r.y + r.h)
      hit.x = x
      hit.y = y
      hit.w = right - x
      hit.h = bottom - y
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** 选区 Range → 页内归一化并块矩形（wRect 为该页 wrapper 的矩形，换算成页的百分比） */
function collectPageRects(range: Range, wRect: DOMRect): NormRect[] {
  return mergeLineRects(
    Array.from(range.getClientRects())
      .map((r) => ({
        x: (r.left - wRect.left) / wRect.width,
        y: (r.top - wRect.top) / wRect.height,
        w: r.width / wRect.width,
        h: r.height / wRect.height,
      }))
      .filter((r) => r.w > 0.001 && r.h > 0.001),
    wRect.height / wRect.width,
  )
}

/**
 * 选区预览层：每页挂一个，自己订阅选区变化。
 * 刻意不放在 PdfReader 的 state 里——拖拽选区时 selectionchange 每帧都来，
 * 状态挂在页列表上会连带 5 个 <Page> 一起重渲染，向右拖动就能感到卡顿。
 * 矩形存成页内百分比，所以滚动也不失配，无需跟 scroll。
 */
function SelectionLayer({ page }: { page: number }) {
  const [rects, setRects] = useState<NormRect[] | null>(null)

  useEffect(() => {
    // 16ms 合并：与一帧同量级。刻意不用 rAF——页面不可见时 rAF 挂起，选区反馈会整个丢掉
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      timer = undefined
      const sel = window.getSelection()
      const node = sel?.anchorNode
      const owner = sel && !sel.isCollapsed && sel.rangeCount
        ? ((node instanceof Element ? node : node?.parentElement)?.closest('[data-page]') as HTMLElement | null)
        : null
      if (!owner || Number(owner.dataset.page) !== page) {
        setRects((prev) => (prev ? null : prev))
        return
      }
      const next = collectPageRects(sel!.getRangeAt(0), owner.getBoundingClientRect())
      setRects(next.length ? next : null)
    }
    const onSel = () => {
      if (timer) return
      timer = setTimeout(sync, 16)
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSel)
    }
  }, [page])

  if (!rects) return null
  return (
    <div className="absolute inset-0 pointer-events-none">
      {rects.map((r, i) => (
        <span
          key={i}
          className="sel-preview absolute"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
          }}
        />
      ))}
    </div>
  )
}

export interface PdfSelectionInfo {
  text: string
  page: number
  rects: NormRect[]
  /** 浮条锚点（容器坐标）：below=true 表示应显示在选区下方 */
  popover: { left: number; y: number; below: boolean }
}

export interface TocItem {
  level: number
  title: string
  page: number
}

interface Props {
  hash: string
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

/** PDF 阅读器：精确占位 + 窗口渲染 + 文本层划词 + 区域截图 + 暗色反色 */
export function PdfReader({
  hash, settings, annotations, jump, onSelection, shotMode, onShot, onProgress, onRestored, onLoaded, scrollRef, initialTarget, onZoom,
}: Props) {
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [ratios, setRatios] = useState<number[]>([]) // 每页 高/宽
  const [containerW, setContainerW] = useState(0)
  const [center, setCenter] = useState(1) // 当前视口中心页
  const [flashId, setFlashId] = useState<string | null>(null)
  // 截图框选状态
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null)
  // 缩放：手势中用 transform 预览（不重排），松手再改页宽、重渲染成清晰的
  const zoom = settings.zoom ?? 1
  const [preview, setPreview] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const liveZoomRef = useRef(zoom)
  const previewRef = useRef(1)
  const zoomAnchor = useRef<{ ratio: number } | null>(null)
  const lastScrollTop = useRef(0)
  const restoredRef = useRef(false)
  const lastJumpTs = useRef(0)
  const lastWriteRef = useRef(0)
  const lastReportedPct = useRef(-1)

  useEffect(() => {
    void getDocBlob(hash).then(async (blob) => {
      if (!blob) return
      setData(await blob.arrayBuffer())
    })
  }, [hash])

  const fitW = Math.max(280, Math.min(containerW - 24, 860))
  const dispW = Math.max(240, Math.min(Math.round(fitW * zoom), 2600))
  const pageH = (i: number) => (ratios[i] ? Math.round(dispW * ratios[i]) : Math.round(dispW * 1.414))
  const offsets = useRef<number[]>([])
  const layout = useCallback(() => {
    const arr: number[] = []
    let acc = 0
    for (let i = 0; i < numPages; i++) {
      arr.push(acc)
      acc += pageH(i) + 16
    }
    offsets.current = arr
    return acc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, dispW, ratios])

  usePinch(scrollRef, {
    onStart: () => { liveZoomRef.current = zoomRef.current },
    onScale: (ratio) => {
      const next = Math.min(3, Math.max(0.5, zoomRef.current * ratio))
      liveZoomRef.current = next
      const p = next / zoomRef.current
      // 变化太小时不重渲染，避免每次 touchmove 都刷整页列表
      if (Math.abs(p - previewRef.current) > 0.01) {
        previewRef.current = p
        setPreview(p)
      }
    },
    onEnd: () => {
      const next = Math.round(liveZoomRef.current * 100) / 100
      previewRef.current = 1
      setPreview(1)
      if (Math.abs(next - zoomRef.current) < 0.01) return
      const el = scrollRef.current
      if (el) {
        const max = el.scrollHeight - el.clientHeight
        zoomAnchor.current = { ratio: max > 0 ? el.scrollTop / max : 0 }
      }
      onZoom?.(next)
    },
  })

  // 页宽变了之后把阅读位置按比例放回去，缩放不会把人甩到别处
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const el = scrollRef.current
    if (!anchor || !el) return
    zoomAnchor.current = null
    const max = el.scrollHeight - el.clientHeight
    el.scrollTop = Math.max(0, anchor.ratio * max)
  }, [dispW])

  // 容器宽度跟踪
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setContainerW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef])

  const onLoad = useCallback(
    async (pdf: import('pdfjs-dist').PDFDocumentProxy) => {
      const n = pdf.numPages
      const ratioOf = async (i: number) => {
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: 1 })
        return vp.height / vp.width
      }
      // 页宽高比（仅元数据，不渲染）必须和 numPages 一次性提交：分两次 setState 会先用猜想的
      // 1.414 画一遍全部占位，真实比例到达后整篇重排 —— 实测 14 页文档每页挪 44px、总高 7794→7178，
      // 而恢复阅读位置又排在重排之后，于是打开文件先看见首页再瞬移到上次阅读处，就是那下抖动。
      // 但 300 页逐个 getPage 要 1.2s，所以先抽样：全篇同尺寸（绝大多数 PDF）就立刻出首帧，
      // 后台再量全篇，真出现混合尺寸才补一次提交；抽样不一致时宁可等量完，保证首帧版面就是对的。
      const same = (a: number, b: number) => Math.abs(a - b) < 1e-3
      const allIdx = Array.from({ length: n }, (_, i) => i + 1)
      const probe = [...new Set([1, n, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75)])].sort((a, b) => a - b)
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

      // 大纲解析：dest → 页码
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
      onLoaded(n, outlineItems)
    },
    [onLoaded],
  )

  // 滚动：双坐标 + 进度
  const onScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || !numPages) return
    layout() // 先保证占位偏移表已填充（首次滚动前无人调用过 layout）
    const top = container.scrollTop
    const maxScroll = container.scrollHeight - container.clientHeight
    const pct = maxScroll > 0 ? Math.min(1, top / maxScroll) : 0

    // 二分找当前页（视口上 1/3 处）
    const probe = top + container.clientHeight * 0.3
    let lo = 0
    let hi = offsets.current.length - 1
    let current = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (offsets.current[mid] <= probe) {
        current = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    setCenter(current + 1)
    const intPct = Math.round(pct * 100)
    if (intPct !== lastReportedPct.current) {
      lastReportedPct.current = intPct
      onProgress(current + 1, intPct / 100)
    }

    const delta = Math.abs(top - lastScrollTop.current)
    lastScrollTop.current = top
    const now = Date.now()
    if (now - lastWriteRef.current < 500) return
    lastWriteRef.current = now
    if (delta < 3000) {
      const pageTop = offsets.current[current]
      const pageHpx = pageH(current)
      const offsetRatio = pageHpx > 0 ? Math.min(1, Math.max(0, (probe - pageTop) / pageHpx)) : 0
      void saveScrollAndProgress(hash, top, { kind: 'pdf', page: current + 1, offsetRatio }, pct)
    } else {
      void saveScrollAndProgress(hash, top, null, pct)
    }
  }, [hash, numPages, onProgress, scrollRef, layout, pageH])

  // 首次挂载：恢复深度进度（与保存基准一致：视口上 1/3）
  // 用 layout effect：滚动必须在浏览器绘制这一帧之前落位，否则先闪一下首页再瞬移到上次阅读处
  useLayoutEffect(() => {
    if (restoredRef.current || !initialTarget || !numPages || !ratios.length) return
    const container = scrollRef.current
    if (!container) return
    layout()
    const pageTop = offsets.current[initialTarget.page - 1] ?? 0
    const h = pageH(initialTarget.page - 1)
    container.scrollTop = Math.max(0, pageTop + initialTarget.offsetRatio * h - container.clientHeight * 0.3)
    restoredRef.current = true
    onRestored()
  }, [initialTarget, numPages, ratios, scrollRef, onRestored, layout, pageH])

  // 跳转（目录/批注/深链）
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

  // 划词检测（mouseup 与移动端 selectionchange/touchend 共用）
  const computePageSelection = useCallback((page: number, wrapper: HTMLElement): PdfSelectionInfo | null => {
    const sel = window.getSelection()
    const container = scrollRef.current
    if (!sel || sel.isCollapsed || !container) return null
    const text = sel.toString().trim()
    if (!text) return null
    const range = sel.getRangeAt(0)
    const wRect = wrapper.getBoundingClientRect()
    const rects = collectPageRects(range, wRect)
    if (!rects.length) return null
    const last = rects[rects.length - 1]
    const firstTop = rects[0].y * wRect.height + wRect.top
    const lastBottom = (last.y + last.h) * wRect.height + wRect.top
    const below = firstTop < 90
    return {
      text,
      page,
      rects,
      popover: {
        left: (last.x + last.w / 2) * wRect.width + wRect.left,
        y: below ? lastBottom : firstTop,
        below,
      },
    }
  }, [scrollRef])

  const onPageMouseUp = useCallback(
    (page: number, wrapper: HTMLElement) => {
      onSelection(computePageSelection(page, wrapper))
    },
    [onSelection, computePageSelection],
  )

  // 移动端长按选词没有 mouseup，靠 selectionchange / touchend 补一次；
  // 250ms 防抖让浮条不在拖拽过程中反复跳动（拖拽中的视觉反馈由 SelectionLayer 逐帧给）
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
        onSelection(pageEl ? computePageSelection(Number(pageEl.dataset.page), pageEl) : null)
      }, 250)
    }
    document.addEventListener('selectionchange', debounced)
    document.addEventListener('touchend', debounced)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', debounced)
      document.removeEventListener('touchend', debounced)
    }
  }, [computePageSelection, onSelection])

  // —— 区域截图（M2.5）：从渲染画布裁剪矩形区域 ——
  const cropCanvas = useCallback((wrapper: HTMLElement, rect: { x: number; y: number; w: number; h: number }): string | null => {
    const canvas = wrapper.querySelector('canvas')
    if (!canvas) return null
    const sx = rect.x * canvas.width
    const sy = rect.y * canvas.height
    const sw = Math.max(2, rect.w * canvas.width)
    const sh = Math.max(2, rect.h * canvas.height)
    const outW = Math.min(480, Math.round(sw))
    const outH = Math.max(2, Math.round(sh * (outW / sw)))
    const out = document.createElement('canvas')
    out.width = outW
    out.height = outH
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH)
    try {
      return out.toDataURL('image/jpeg', 0.82)
    } catch {
      return null
    }
  }, [])

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
    if (w < 0.02 || h < 0.02) return // 过小的框选视为误触
    const img = cropCanvas(wrapper, { x, y, w, h })
    if (img && onShot) {
      onShot({ page, rects: [{ x, y, w, h }], img })
    }
    // 清掉可能残留的文本选择
    window.getSelection()?.removeAllRanges()
  }, [shotMode, drag, cropCanvas, onShot])

  const renderWindow = containerW > 0 && containerW < 768 ? RENDER_WINDOW_NARROW : RENDER_WINDOW_WIDE
  const lo = Math.max(1, center - renderWindow)
  const hi = Math.min(numPages, center + renderWindow)
  const dark = settings.theme === 'night' || settings.theme === 'dusk'

  // 历史批注存的是逐 span 的碎矩形，渲染前同样并一次块（并块幂等，新批注无副作用）
  const annRects = useMemo(() => {
    const m = new Map<string, NormRect[]>()
    for (const a of annotations) {
      if (!a.rects?.length) continue
      m.set(a.id, mergeLineRects(a.rects, ratios[(a.page ?? 1) - 1] ?? 1.414))
    }
    return m
  }, [annotations, ratios])

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // pan-x pan-y：禁掉浏览器整页缩放，横竖滚动交给容器自己；双指手势由 usePinch 接
        style={{ touchAction: 'pan-x pan-y' }}
        className="h-full overflow-auto overscroll-contain bg-surface-3/50"
      >
        <div style={{ transform: preview !== 1 ? `scale(${preview})` : undefined, transformOrigin: 'top center' }}>
          <Document
            file={data ?? undefined}
            onLoadSuccess={onLoad}
            loading={<div className="grid place-items-center h-40 text-on-surface-2 text-[13px]">正在载入 PDF…</div>}
            error={<div className="grid place-items-center h-40 text-danger text-[13px]">无法打开此 PDF</div>}
            className="flex flex-col items-start py-4 gap-4"
            options={PDF_OPTIONS}
          >
        {numPages > 0 &&
          Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
            const inWindow = p >= lo && p <= hi
            return (
              // mx-auto：页宽小于容器时居中；放大到超出容器时从左侧开始，横向滚动才够得着
              <div key={p} className="flex flex-col items-center gap-1 mx-auto">
                <div
                  data-page={p}
                  style={{ width: dispW, height: pageH(p - 1) }}
                  className={`relative rounded-[10px] overflow-hidden bg-white shadow-sm ${dark ? 'pdf-dark' : ''} ${shotMode ? 'cursor-crosshair select-none' : ''}`}
                  onMouseUp={(e) => (shotMode ? onShotMouseUp(e, p, e.currentTarget) : onPageMouseUp(p, e.currentTarget))}
                  onMouseDown={(e) => onShotMouseDown(e, p, e.currentTarget)}
                  onMouseMove={(e) => onShotMouseMove(e, p, e.currentTarget)}
                >
                  {inWindow ? (
                    <Page
                      pageNumber={p}
                      width={dispW}
                      devicePixelRatio={PDF_DPR}
                      renderTextLayer
                      renderAnnotationLayer={false}
                      loading=""
                    />
                  ) : null}
                  {/* 截图框选预览 */}
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
                  {/* 批注叠层：文字高亮填充 / 截图批注描边 */}
                  {annotations
                    .filter((a) => a.page === p && a.rects)
                    .map((a) => {
                      const isShot = a.kind === 'shot'
                      const colorCls = a.color === 'yellow' ? 'hl-yellow' : a.color === 'green' ? 'hl-green' : a.color === 'blue' ? 'hl-blue' : 'hl-red'
                      return (
                        <div
                          key={a.id}
                          data-ann={a.id}
                          className={`absolute inset-0 pointer-events-none ${flashId === a.id ? 'ann-flash' : ''}`}
                          style={{ ['--ann-opacity' as string]: '0.4' }}
                        >
                          {(annRects.get(a.id) ?? a.rects!).map((r, ri) => (
                            <span
                              key={ri}
                              className={cn('absolute', isShot ? 'border-2 border-primary' : colorCls)}
                              style={{
                                left: `${r.x * 100}%`,
                                top: `${r.y * 100}%`,
                                width: `${r.w * 100}%`,
                                height: `${r.h * 100}%`,
                                ...(isShot ? { background: 'color-mix(in srgb, var(--primary) 8%, transparent)' } : {}),
                              }}
                            />
                          ))}
                        </div>
                      )
                    })}
                  {/* 选区预览：独立组件，拖拽时只有它自己重渲染 */}
                  {!shotMode && <SelectionLayer page={p} />}
                </div>
                <span className="text-[11px] text-on-surface-2 select-none">
                  {p} / {numPages}
                </span>
              </div>
            )
          })}
          </Document>
        </div>
      </div>
      {zoom !== 1 && (
        <button
          onClick={() => onZoom?.(1)}
          className="absolute bottom-3 right-3 z-10 h-8 px-3 rounded-full bg-surface/95 border border-outline shadow-sm text-[12px] text-on-surface-2 backdrop-blur cursor-pointer"
        >
          {Math.round(zoom * 100)}% · 重置
        </button>
      )}
    </div>
  )
}
