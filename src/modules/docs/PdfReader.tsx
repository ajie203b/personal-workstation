import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { saveScrollAndProgress } from '@/db/docs'
import type { Annotation, DocSettings } from '@/db/db'
import { getDocBlob } from '@/db/docs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfSelectionInfo {
  text: string
  page: number
  rects: { x: number; y: number; w: number; h: number }[]
  popover: { left: number; top: number }
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
  onProgress: (page: number, pct: number) => void
  onRestored: () => void
  onLoaded: (numPages: number, outline: TocItem[]) => void
  scrollRef: React.RefObject<HTMLDivElement>
  initialTarget: { page: number; offsetRatio: number } | null
}

const RENDER_WINDOW = 2 // 当前页前后各渲染 2 页

// 注意：必须保持同一引用 —— 内联对象会让 react-pdf 认为 options 变化，
// 用已被 transfer（detached）的 ArrayBuffer 重新加载而崩溃
const PDF_OPTIONS = {
  cMapUrl: 'pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'pdfjs/standard_fonts/',
}

/** PDF 阅读器：精确占位 + 窗口渲染 + 文本层划词 + 暗色反色 */
export function PdfReader({
  hash, settings, annotations, jump, onSelection, onProgress, onRestored, onLoaded, scrollRef, initialTarget,
}: Props) {
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [ratios, setRatios] = useState<number[]>([]) // 每页 高/宽
  const [containerW, setContainerW] = useState(0)
  const [center, setCenter] = useState(1) // 当前视口中心页
  const [flashId, setFlashId] = useState<string | null>(null)
  const lastScrollTop = useRef(0)
  const restoredRef = useRef(false)
  const lastJumpTs = useRef(0)

  useEffect(() => {
    void getDocBlob(hash).then(async (blob) => {
      if (!blob) return
      setData(await blob.arrayBuffer())
    })
  }, [hash])

  const dispW = Math.max(280, Math.min(containerW - 24, 860))
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
      setNumPages(n)
      // 全量取页面宽高比（仅元数据，不渲染），占位零漂移
      const rs: number[] = []
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: 1 })
        rs.push(vp.height / vp.width)
      }
      setRatios(rs)

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
    onProgress(current + 1, pct)

    const delta = Math.abs(top - lastScrollTop.current)
    lastScrollTop.current = top
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
  useEffect(() => {
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

  // 划词检测
  const onPageMouseUp = useCallback(
    (page: number, wrapper: HTMLElement) => {
      const sel = window.getSelection()
      const container = scrollRef.current
      if (!sel || sel.isCollapsed || !container) {
        onSelection(null)
        return
      }
      const text = sel.toString().trim()
      if (!text) {
        onSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      const wRect = wrapper.getBoundingClientRect()
      const cRect = container.getBoundingClientRect()
      const rects = Array.from(range.getClientRects())
        .map((r) => ({
          x: (r.left - wRect.left) / wRect.width,
          y: (r.top - wRect.top) / wRect.height,
          w: r.width / wRect.width,
          h: r.height / wRect.height,
        }))
        .filter((r) => r.w > 0.001 && r.h > 0.001)
      if (!rects.length) {
        onSelection(null)
        return
      }
      const last = rects[rects.length - 1]
      onSelection({
        text,
        page,
        rects,
        popover: {
          left: (last.x + last.w / 2) * wRect.width + (wRect.left - cRect.left),
          top: last.y * wRect.height + (wRect.top - cRect.top) - 6,
        },
      })
    },
    [onSelection, scrollRef],
  )

  const lo = Math.max(1, center - RENDER_WINDOW)
  const hi = Math.min(numPages, center + RENDER_WINDOW)
  const dark = settings.theme === 'night' || settings.theme === 'dusk'

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto bg-surface-3/50">
      <Document
        file={data ?? undefined}
        onLoadSuccess={onLoad}
        loading={<div className="grid place-items-center h-40 text-on-surface-2 text-[13.5px]">正在载入 PDF…</div>}
        error={<div className="grid place-items-center h-40 text-danger text-[13.5px]">无法打开此 PDF</div>}
        className="flex flex-col items-center py-4 gap-4"
        options={PDF_OPTIONS}
      >
        {numPages > 0 &&
          Array.from({ length: numPages }, (_, i) => i + 1).map((p) => {
            const inWindow = p >= lo && p <= hi
            return (
              <div key={p} className="flex flex-col items-center gap-1">
                <div
                  data-page={p}
                  style={{ width: dispW, height: pageH(p - 1) }}
                  className={`relative rounded-[8px] overflow-hidden bg-white shadow-sm ${dark ? 'pdf-dark' : ''}`}
                  onMouseUp={(e) => onPageMouseUp(p, e.currentTarget)}
                >
                  {inWindow ? (
                    <Page
                      pageNumber={p}
                      width={dispW}
                      renderTextLayer
                      renderAnnotationLayer={false}
                      loading=""
                    />
                  ) : null}
                  {/* 批注高亮叠层 */}
                  {annotations
                    .filter((a) => a.page === p && a.rects)
                    .map((a) => (
                      <div
                        key={a.id}
                        data-ann={a.id}
                        className={`absolute pointer-events-none ${a.color === 'yellow' ? 'hl-yellow' : a.color === 'green' ? 'hl-green' : a.color === 'blue' ? 'hl-blue' : 'hl-red'} ${flashId === a.id ? 'ann-flash' : ''}`}
                        style={{ ['--ann-opacity' as string]: '0.4' }}
                      >
                        {a.rects!.map((r, ri) => (
                          <span
                            key={ri}
                            className="absolute"
                            style={{
                              left: `${r.x * 100}%`,
                              top: `${r.y * 100}%`,
                              width: `${r.w * 100}%`,
                              height: `${r.h * 100}%`,
                            }}
                          />
                        ))}
                      </div>
                    ))}
                </div>
                <span className="text-[11px] text-on-surface-2 select-none">
                  {p} / {numPages}
                </span>
              </div>
            )
          })}
      </Document>
    </div>
  )
}
