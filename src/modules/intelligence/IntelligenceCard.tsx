import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2, RefreshCw, X } from 'lucide-react'
import { openExternal } from '@/lib/links'
import { isNative } from '@/lib/native'
import { INTEL_CHART_META_URLS, INTEL_CHART_URLS } from '@/lib/intelSources'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'

interface ChartMeta {
  fingerprint?: string
  generatedAt?: string
}

function formatUpdatedAt(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

async function fetchChartMeta(url: string, signal?: AbortSignal): Promise<ChartMeta | null> {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal })
    if (!res.ok) return null
    const body = await res.json() as ChartMeta | null
    if (!body || typeof body !== 'object') return null
    return {
      fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : undefined,
      generatedAt: typeof body.generatedAt === 'string' ? body.generatedAt : undefined,
    }
  } catch {
    return null
  }
}

function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = new Image()
    probe.onload = () => resolve(true)
    probe.onerror = () => resolve(false)
    probe.src = url
  })
}

/**
 * AI 模型智能排行榜（独立旗舰板块，硬性置顶于工具页最上方，不属于「小工具」目录）。
 * 保留 Artificial Analysis 官方原图，支持拖拽横移、原图高清灯箱与即时刷新。
 */
export function IntelligenceCard() {
  const toast = useUi((s) => s.toast)
  const [dragging, setDragging] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [fitWidth, setFitWidth] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')
  const [scrollEdge, setScrollEdge] = useState({ left: false, right: false })
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const localChart = `${import.meta.env.BASE_URL}intelligence/chart.png`
  const localMeta = `${import.meta.env.BASE_URL}intelligence/chart-meta.json`
  const [chartSrc, setChartSrc] = useState(localChart)

  const syncScrollEdge = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollEdge({
      left: el.scrollLeft > 6,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 6,
    })
  }, [])

  useEffect(() => {
    syncScrollEdge()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncScrollEdge)
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncScrollEdge, chartSrc])

  const loadLatestChart = useCallback(async (manual: boolean, signal?: AbortSignal) => {
    setRefreshing(true)
    try {
      let bestUrl = ''
      let bestUpdatedAt = ''
      let bestTs = -1

      for (let i = 0; i < INTEL_CHART_URLS.length; i++) {
        if (signal?.aborted) return
        const meta = await fetchChartMeta(INTEL_CHART_META_URLS[i], signal)
        const token = manual ? String(Date.now()) : (meta?.fingerprint?.slice(0, 12) || String(Math.floor(Date.now() / 600_000)))
        const url = `${INTEL_CHART_URLS[i]}?v=${token}`
        const ok = await probeImage(url)
        if (signal?.aborted) return
        if (!ok) continue
        const ts = meta?.generatedAt ? Date.parse(meta.generatedAt) : 0
        if (!bestUrl || (Number.isFinite(ts) && ts > bestTs)) {
          bestUrl = url
          bestUpdatedAt = meta?.generatedAt ?? ''
          bestTs = Number.isFinite(ts) ? ts : 0
        }
        if (i === 0 && meta?.generatedAt) break
      }

      if (!mountedRef.current || signal?.aborted) return
      if (bestUrl) {
        setImageFailed(false)
        setChartSrc(bestUrl)
        if (bestUpdatedAt) setUpdatedAt(bestUpdatedAt)
        if (manual) toast('模型榜单已刷新')
      } else {
        const fallbackMeta = await fetchChartMeta(localMeta, signal)
        if (mountedRef.current && fallbackMeta?.generatedAt) {
          setUpdatedAt((prev) => prev || fallbackMeta.generatedAt!)
        }
        if (manual) toast('暂时无法获取最新图表，已保留当前显示')
      }
    } finally {
      if (mountedRef.current) setRefreshing(false)
    }
  }, [localMeta, toast])

  useEffect(() => {
    mountedRef.current = true
    const ctrl = new AbortController()
    void loadLatestChart(false, ctrl.signal)
    return () => {
      mountedRef.current = false
      ctrl.abort()
    }
  }, [loadLatestChart])

  const openOriginal = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setFitWidth(false)
    setZoomed(true)
  }

  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])

  const updatedLabel = formatUpdatedAt(updatedAt)

  return (
    <section aria-labelledby="ranking-heading" data-pinned-leaderboard="true" className="ranking-panel">
      <span aria-hidden className="ranking-prism-bar" />
      <header className="ranking-intro">
        <div className="flex items-center justify-between gap-2">
          <h2 id="ranking-heading" className="ranking-heading min-w-0">AI 模型智能排行榜</h2>
          <div className="ranking-actions">
            <button
              type="button"
              aria-label="刷新模型排名图表"
              title="立即刷新榜单"
              disabled={refreshing}
              onClick={() => void loadLatestChart(true)}
              className="ranking-action cursor-pointer disabled:opacity-60"
            >
              <RefreshCw size={15} aria-hidden className={cn(refreshing && 'animate-spin')} />
            </button>
            <button
              type="button"
              aria-label="大图查看原图"
              title="查看大图"
              onClick={openOriginal}
              className="ranking-action cursor-pointer"
            >
              <Maximize2 size={15} aria-hidden />
            </button>
            <a
              href="https://artificialanalysis.ai/leaderboards/models"
              rel="noopener noreferrer"
              aria-label="打开 Artificial Analysis 官网榜单"
              title="查看官网榜单"
              onClick={(e) => { e.preventDefault(); openExternal('https://artificialanalysis.ai/leaderboards/models') }}
              className="ranking-action"
            >
              <ExternalLink size={15} aria-hidden />
            </a>
          </div>
        </div>
        <p className="ranking-meta">
          <span>Artificial Analysis 官方指数</span>
          {updatedLabel && (
            <time dateTime={updatedAt} className="tabular-nums">· 更新于 {updatedLabel}</time>
          )}
        </p>
      </header>

      <div className="ranking-plot">
        {imageFailed ? (
          <p className="py-8 text-[13px] text-on-surface-2 text-center" role="status">
            榜单图片暂时无法加载，请点击右上角入口查看 Artificial Analysis 官网榜单。
          </p>
        ) : (
          <div className="ranking-paper">
            <div
              ref={scrollRef}
              role="region"
              aria-label="模型排名图表，可左右滑动或用方向键滚动"
              tabIndex={0}
              onScroll={syncScrollEdge}
              className="overflow-x-auto overscroll-x-contain pb-0.5 md:pb-1 rounded-[10px] cursor-grab active:cursor-grabbing select-none"
              onPointerDown={(event) => {
                if (event.pointerType !== 'mouse' || event.button !== 0) return
                dragRef.current = { x: event.clientX, left: event.currentTarget.scrollLeft }
                setDragging(true)
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                if (!drag) return
                event.preventDefault()
                event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x)
              }}
              onPointerUp={(event) => {
                dragRef.current = null
                setDragging(false)
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
              onLostPointerCapture={() => { dragRef.current = null; setDragging(false) }}
            >
              <img
                src={chartSrc}
                alt="Artificial Analysis 模型智能指数排名官方原图"
                width={2732}
                height={640}
                draggable={false}
                onLoad={syncScrollEdge}
                onError={() => {
                  if (chartSrc !== localChart) setChartSrc(localChart)
                  else setImageFailed(true)
                }}
                className="h-[clamp(158px,23dvh,210px)] md:h-[clamp(200px,32dvh,292px)] w-auto max-w-none rounded-[8px] select-none pointer-events-none"
              />
            </div>
            {scrollEdge.left && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white dark:from-[#F8FAFC] via-white/75 dark:via-[#F8FAFC]/75 to-transparent"
              />
            )}
            {scrollEdge.right && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white dark:from-[#F8FAFC] via-white/80 dark:via-[#F8FAFC]/80 to-transparent"
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2.5 text-[11.5px] md:text-[12px] text-on-surface-2 mt-2 md:mt-2.5 px-0.5">
          <span className="min-w-0 truncate">
            {dragging ? '拖动浏览中…' : '左右滑动或拖拽查看完整排名'}
          </span>
          <a
            href={chartSrc}
            rel="noopener noreferrer"
            onClick={openOriginal}
            className="inline-flex items-center gap-1 px-2.5 py-1 -mr-1 rounded-full text-[11.5px] md:text-[12px] font-medium text-primary bg-primary-soft/75 hover:bg-primary-soft transition-colors shrink-0"
          >
            查看原图 <Maximize2 size={11.5} aria-hidden />
          </a>
        </div>
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-6 cursor-zoom-out overlay-fade"
          role="dialog"
          aria-modal="true"
          aria-label="模型排名图表原图"
          onClick={() => setZoomed(false)}
        >
          <div
            className="w-full max-w-[94vw] flex items-center justify-end gap-2 mb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setFitWidth((v) => !v)}
              className="px-3.5 h-9 rounded-full bg-white/14 backdrop-blur-md border border-white/15 text-white text-[12.5px] font-medium hover:bg-white/24 transition-colors cursor-pointer"
            >
              {fitWidth ? '原图横向滚动' : '适应屏幕宽度'}
            </button>
            {!isNative() && (
              <button
                type="button"
                onClick={() => openExternal(chartSrc)}
                className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-white/14 backdrop-blur-md border border-white/15 text-white text-[12.5px] font-medium hover:bg-white/24 transition-colors cursor-pointer"
              >
                新窗口打开 <ExternalLink size={12} aria-hidden />
              </button>
            )}
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setZoomed(false)}
              className="grid place-items-center w-9 h-9 rounded-full bg-white/14 backdrop-blur-md border border-white/15 text-white hover:bg-white/24 transition-colors cursor-pointer"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div
            className="max-w-[94vw] max-h-[82dvh] overflow-auto rounded-[18px] bg-white p-3 shadow-2xl ring-1 ring-white/20 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={chartSrc}
              alt="Artificial Analysis 模型智能指数排名官方原图"
              className={cn(
                'rounded-[10px] select-none',
                fitWidth ? 'w-full h-auto max-h-[76dvh] object-contain' : 'h-[min(500px,68dvh)] w-auto max-w-none',
              )}
              draggable={false}
            />
          </div>
        </div>
      )}
    </section>
  )
}
