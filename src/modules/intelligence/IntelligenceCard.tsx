import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { ExternalLink, Maximize2, RefreshCw } from 'lucide-react'
import { openExternal } from '@/lib/links'
import { Dialog } from '@/shared/ui/Sheet'
import { isNative, isTauri } from '@/lib/native'
import { INTEL_CHART_META_URLS, INTEL_CHART_URLS } from '@/lib/intelSources'
import type { RankingChart } from '@/db/db'
import { downloadChartImage, readChart, saveChart } from './chartCache'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'

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

async function fetchChartDate(url: string, signal: AbortSignal): Promise<string> {
  try {
    const res = await fetch(url, { cache: 'no-cache', signal })
    if (!res.ok) return ''
    const body = await res.json()
    return typeof body?.generatedAt === 'string' ? body.generatedAt : ''
  } catch {
    return ''
  }
}

const localChart = `${import.meta.env.BASE_URL}intelligence/chart.png`
const localMeta = `${import.meta.env.BASE_URL}intelligence/chart-meta.json`

export function IntelligenceCard() {
  const toast = useUi((s) => s.toast)
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [fitWidth, setFitWidth] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [localDate, setLocalDate] = useState('')
  const [scrollEdge, setScrollEdge] = useState({ left: false, right: false })
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const refreshRef = useRef<AbortController | null>(null)
  const [remoteChart, setRemoteChart] = useState<{ url: string; date: string } | null>()
  const chartSrc = remoteChart === null ? localChart : remoteChart?.url
  const updatedAt = remoteChart === null ? localDate : remoteChart?.date ?? ''

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

  useEffect(() => {
    const controller = new AbortController()
    void readChart().then((cached) => {
      if (controller.signal.aborted) return
      setRemoteChart(cached ? { url: URL.createObjectURL(cached.image), date: cached.date } : null)
    }).catch(() => {
      if (!controller.signal.aborted) setRemoteChart(null)
    })
    void fetchChartDate(localMeta, controller.signal).then((date) => {
      if (!controller.signal.aborted) setLocalDate(date)
    })
    return () => {
      controller.abort()
      refreshRef.current?.abort()
      refreshRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (remoteChart) URL.revokeObjectURL(remoteChart.url)
    }
  }, [remoteChart])

  const refresh = async () => {
    if (refreshRef.current) return
    setRefreshing(true)
    const requestedAt = Date.now()
    let best: RankingChart | null = null
    for (const [index, source] of INTEL_CHART_URLS.entries()) {
      const controller = new AbortController()
      refreshRef.current = controller
      const timer = window.setTimeout(() => controller.abort(), 5000)
      const url = `${source}?v=${Date.now()}`
      try {
        const [image, date] = await Promise.all([
          downloadChartImage(url, controller.signal),
          fetchChartDate(INTEL_CHART_META_URLS[index], controller.signal),
        ])
        if (refreshRef.current !== controller) return
        if (image && (!best || date)) best = { image, date, requestedAt }
        if (best?.date) break
      } finally {
        window.clearTimeout(timer)
      }
    }
    if (best) {
      let message = '模型榜单已保存，下次打开可离线查看'
      const active = refreshRef.current
      try {
        best = await saveChart(best)
      } catch {
        message = '榜单已刷新，本机缓存保存失败'
      }
      if (refreshRef.current !== active) return
      setImageFailed(false)
      setRemoteChart({ url: URL.createObjectURL(best.image), date: best.date })
      toast(message)
    } else {
      toast('暂时无法获取最新图表，已保留当前显示')
    }
    refreshRef.current = null
    setRefreshing(false)
  }

  const openOriginal = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    setFitWidth(false)
    setZoomed(true)
  }

  const updatedLabel = formatUpdatedAt(updatedAt)

  return (
    <section aria-labelledby="ranking-heading" data-pinned-leaderboard="true" className="ranking-panel">
      <header className="ranking-intro">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 id="ranking-heading" className="ranking-heading truncate">AI 模型智能排行榜</h2>
            {updatedLabel && (
              <time dateTime={updatedAt} className="hidden sm:inline text-[11.5px] text-on-surface-2 tabular-nums shrink-0">
                {updatedLabel}
              </time>
            )}
          </div>
          <div className="ranking-actions">
            <button
              type="button"
              aria-label="刷新模型排名图表"
              title="立即刷新榜单"
              disabled={refreshing || remoteChart === undefined}
              onClick={() => void refresh()}
              className="ranking-action cursor-pointer disabled:opacity-60"
            >
              <RefreshCw size={14} aria-hidden className={cn(refreshing && 'animate-spin')} />
            </button>
            <button
              type="button"
              aria-label="查看原图"
              title="查看原图"
              disabled={!chartSrc}
              onClick={openOriginal}
              className="ranking-action cursor-pointer"
            >
              <Maximize2 size={14} aria-hidden />
            </button>
            <a
              href="https://artificialanalysis.ai/leaderboards/models"
              rel="noopener noreferrer"
              aria-label="打开 Artificial Analysis 官网榜单"
              title="查看官网榜单"
              onClick={(e) => { e.preventDefault(); openExternal('https://artificialanalysis.ai/leaderboards/models') }}
              className="ranking-action"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>
        </div>
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
              className="overflow-x-auto overscroll-x-contain rounded-[8px] cursor-grab active:cursor-grabbing select-none"
              onPointerDown={(event) => {
                if (event.pointerType !== 'mouse' || event.button !== 0) return
                dragRef.current = { x: event.clientX, left: event.currentTarget.scrollLeft }
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
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { dragRef.current = null }}
              onLostPointerCapture={() => { dragRef.current = null }}
            >
              <img
                src={chartSrc}
                alt="Artificial Analysis 模型智能指数排名官方原图"
                width={2288}
                height={658}
                draggable={false}
                onLoad={syncScrollEdge}
                onError={() => {
                  if (remoteChart) setRemoteChart(null)
                  else setImageFailed(true)
                }}
                className="h-[clamp(220px,34dvh,300px)] md:h-[clamp(280px,44dvh,380px)] w-auto max-w-none rounded-[6px] select-none pointer-events-none"
              />
            </div>
            {scrollEdge.left && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[var(--ranking-paper)] to-transparent"
              />
            )}
            {scrollEdge.right && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--ranking-paper)] to-transparent"
              />
            )}
          </div>
        )}
      </div>

      <Dialog open={zoomed} onOpenChange={setZoomed} title="模型排名图表原图" widthClass="w-[94vw]">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => setFitWidth((value) => !value)}
            className="min-h-10 rounded-lg bg-surface-2 px-3 hover:bg-surface-3 cursor-pointer"
          >
            {fitWidth ? '原图横向滚动' : '适应屏幕宽度'}
          </button>
          {!isNative() && (
            <button
              type="button"
              onClick={() => openExternal(isTauri() ? INTEL_CHART_URLS[0] : chartSrc ?? localChart)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-primary hover:bg-primary-soft cursor-pointer"
            >
              {isTauri() ? '查看线上原图' : '新窗口打开'} <ExternalLink size={14} aria-hidden />
            </button>
          )}
        </div>
        <div role="region" aria-label="榜单原图" tabIndex={0} className="overflow-auto overscroll-contain rounded-lg bg-[var(--ranking-paper)]">
          <img
            src={chartSrc}
            alt="Artificial Analysis 模型智能指数排名官方原图"
            className={fitWidth ? 'w-full h-auto' : 'h-[min(620px,70dvh)] w-auto max-w-none'}
            draggable={false}
          />
        </div>
      </Dialog>
    </section>
  )
}
