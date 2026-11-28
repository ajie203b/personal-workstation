import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ExternalLink, Maximize2, RefreshCw, Search, X } from 'lucide-react'
import { openExternal } from '@/lib/links'
import { Dialog } from '@/shared/ui/Sheet'
import { TopProgressLine } from '@/shared/ui/TopProgressLine'
import { isNative, isTauri } from '@/lib/native'
import { INTEL_CHART_META_URLS, INTEL_CHART_URLS } from '@/lib/intelSources'
import {
  detectIntelVendor,
  loadBuiltinIntel,
  loadCachedIntel,
  refreshIntelDetailed,
  type IntelData,
} from '@/lib/intelligence'
import type { RankingChart } from '@/db/db'
import { downloadChartImage, readChart, saveChart } from './chartCache'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'

type ViewMode = 'chart' | 'list'

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
  const [viewMode, setViewMode] = useState<ViewMode>('chart')
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [fitWidth, setFitWidth] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [localDate, setLocalDate] = useState('')
  const [scrollEdge, setScrollEdge] = useState({ left: false, right: false })
  const [intelData, setIntelData] = useState<IntelData | null>(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [vendorFilter, setVendorFilter] = useState('全部')
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const refreshRef = useRef<AbortController | null>(null)
  const [remoteChart, setRemoteChart] = useState<{ url: string; date: string } | null>()
  const chartSrc = remoteChart === null ? localChart : remoteChart?.url
  const chartUpdatedAt = remoteChart === null ? localDate : remoteChart?.date ?? ''
  const updatedAt = viewMode === 'list' ? (intelData?.generatedAt || chartUpdatedAt) : chartUpdatedAt

  const syncScrollEdge = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollEdge({
      left: el.scrollLeft > 6,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 6,
    })
  }, [])

  useEffect(() => {
    if (viewMode !== 'chart') return
    syncScrollEdge()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncScrollEdge)
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncScrollEdge, chartSrc, viewMode])

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

  // 切换到交互列表视图时按需加载缓存 / 内置快照并后台静默刷新
  useEffect(() => {
    if (viewMode !== 'list') return
    const controller = new AbortController()
    let active = true
    setIntelLoading((prev) => prev || !intelData)
    void (async () => {
      const cached = await loadCachedIntel()
      if (!active) return
      if (cached) {
        setIntelData(cached)
        setIntelLoading(false)
      } else {
        const builtin = await loadBuiltinIntel(controller.signal)
        if (!active) return
        if (builtin) setIntelData(builtin)
        setIntelLoading(false)
      }
      const { data } = await refreshIntelDetailed(false)
      if (active && data) setIntelData(data)
    })()
    return () => {
      active = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  const vendors = useMemo(() => {
    if (!intelData) return ['全部']
    const seen = new Set<string>()
    for (const m of intelData.models) seen.add(detectIntelVendor(m.name))
    return ['全部', ...Array.from(seen)]
  }, [intelData])

  const filteredModels = useMemo(() => {
    if (!intelData) return []
    const needle = searchQuery.trim().toLowerCase()
    return intelData.models
      .map((model, index) => ({
        ...model,
        rank: index + 1,
        vendor: detectIntelVendor(model.name),
      }))
      .filter((item) => {
        if (vendorFilter !== '全部' && item.vendor !== vendorFilter) return false
        if (needle && !item.name.toLowerCase().includes(needle) && !item.vendor.toLowerCase().includes(needle)) {
          return false
        }
        return true
      })
  }, [intelData, searchQuery, vendorFilter])

  const topScore = intelData?.models[0]?.score || 100
  const [chartProgress, setChartProgress] = useState<number | null>(null)

  const refresh = async () => {
    if (viewMode === 'list') {
      if (refreshing) return
      setRefreshing(true)
      setChartProgress(null)
      try {
        const res = await refreshIntelDetailed(true)
        if (res.data) setIntelData(res.data)
        toast(res.fetched ? '模型排行列表已更新' : '暂时无法获取最新数据，已保留当前显示')
      } finally {
        setRefreshing(false)
      }
      return
    }
    if (refreshRef.current) return
    setRefreshing(true)
    setChartProgress(null)
    const requestedAt = Date.now()
    let best: RankingChart | null = null
    let lastController: AbortController | null = null
    try {
      for (const [index, source] of INTEL_CHART_URLS.entries()) {
        const controller = new AbortController()
        lastController = controller
        refreshRef.current = controller
        const timer = window.setTimeout(() => controller.abort(), 5000)
        const stamp = Date.now()
        const url = `${source}?v=${stamp}`
        const metaUrl = `${INTEL_CHART_META_URLS[index]}?v=${stamp}`
        try {
          const [image, date] = await Promise.all([
            downloadChartImage(url, controller.signal, (loaded, total) => {
              if (refreshRef.current === controller) {
                setChartProgress(total > 0 ? loaded / total : null)
              }
            }),
            fetchChartDate(metaUrl, controller.signal),
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
    } finally {
      if (!lastController || refreshRef.current === lastController) {
        refreshRef.current = null
      }
      setRefreshing(false)
      setChartProgress(null)
    }
  }

  const openOriginal = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    setFitWidth(false)
    setZoomed(true)
  }

  const updatedLabel = formatUpdatedAt(updatedAt)

  return (
    <section aria-labelledby="ranking-heading" data-pinned-leaderboard="true" className="ranking-panel relative overflow-hidden">
      <TopProgressLine
        active={refreshing || intelLoading}
        progress={refreshing && viewMode === 'chart' ? chartProgress : null}
        label="正在刷新 AI 榜单"
      />
      <header className="ranking-intro">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 id="ranking-heading" className="ranking-heading truncate">AI 模型智能排行榜</h2>
            {updatedLabel && (
              <time dateTime={updatedAt} className="text-[11px] sm:text-[11.5px] text-on-surface-2 tabular-nums shrink-0">
                {updatedLabel}
              </time>
            )}
          </div>
          <div className="ranking-actions">
            <div
              role="group"
              aria-label="榜单视图切换"
              className="inline-flex items-center rounded-[9px] bg-surface-2 p-0.5 border border-outline/60 mr-0.5"
            >
              <button
                type="button"
                aria-pressed={viewMode === 'chart'}
                onClick={() => setViewMode('chart')}
                className={cn(
                  'h-7 px-2.5 rounded-[7px] text-[11.5px] font-medium transition-colors cursor-pointer',
                  viewMode === 'chart'
                    ? 'bg-surface text-on-surface shadow-xs'
                    : 'text-on-surface-2 hover:text-on-surface',
                )}
              >
                图表
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
                className={cn(
                  'h-7 px-2.5 rounded-[7px] text-[11.5px] font-medium transition-colors cursor-pointer',
                  viewMode === 'list'
                    ? 'bg-surface text-on-surface shadow-xs'
                    : 'text-on-surface-2 hover:text-on-surface',
                )}
              >
                列表
              </button>
            </div>
            <button
              type="button"
              aria-label={viewMode === 'list' ? '刷新模型排行列表' : '刷新模型排名图表'}
              title="立即刷新榜单"
              disabled={refreshing || (viewMode === 'chart' && remoteChart === undefined)}
              onClick={() => void refresh()}
              className="ranking-action cursor-pointer disabled:opacity-60"
            >
              <RefreshCw size={14} aria-hidden className={cn(refreshing && 'animate-spin')} />
            </button>
            {viewMode === 'chart' && (
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
            )}
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
        {viewMode === 'list' ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="relative sm:w-56 shrink-0">
                <Search size={13.5} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索模型或厂商…"
                  aria-label="搜索模型或厂商"
                  className="w-full h-8 rounded-[9px] border border-outline/70 bg-surface-2 pl-8 pr-7 text-[12px] outline-none focus:border-primary/60"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="清空模型搜索"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-on-surface-2 hover:text-on-surface cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5" role="group" aria-label="按厂商筛选模型">
                {vendors.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={vendorFilter === v}
                    onClick={() => setVendorFilter(v)}
                    className={cn(
                      'shrink-0 h-7 px-2.5 rounded-full text-[11.5px] transition-colors cursor-pointer border',
                      vendorFilter === v
                        ? 'border-primary/60 bg-primary-soft text-primary font-medium'
                        : 'border-outline/60 bg-surface-2/60 text-on-surface-2 hover:text-on-surface',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {intelLoading && !intelData ? (
              <p className="py-8 text-[12.5px] text-on-surface-2 text-center" role="status">
                正在载入模型指数数据…
              </p>
            ) : !intelData ? (
              <p className="py-8 text-[12.5px] text-on-surface-2 text-center" role="status">
                暂无可用的结构化榜单数据，可点击右上角刷新或切回「图表」视图。
              </p>
            ) : filteredModels.length === 0 ? (
              <p className="py-8 text-[12.5px] text-on-surface-2 text-center" role="status">
                没有匹配的模型，试试清空搜索词或切换厂商筛选。
              </p>
            ) : (
              <ol
                aria-label="AI 模型智能排行榜列表"
                className="max-h-[clamp(240px,38dvh,380px)] overflow-y-auto overscroll-contain divide-y divide-outline/40 rounded-[10px] border border-outline/60 bg-surface-2/40"
              >
                {filteredModels.map((item) => {
                  const pct = Math.max(4, Math.min(100, Math.round((item.score / topScore) * 100)))
                  return (
                    <li
                      key={`${item.rank}-${item.name}`}
                      className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-surface-2/80 transition-colors"
                    >
                      <span
                        className={cn(
                          'w-6 text-center text-[11px] font-semibold tabular-nums shrink-0 rounded-[6px] py-0.5',
                          item.rank <= 3
                            ? 'bg-primary-soft text-primary'
                            : 'text-on-surface-2',
                        )}
                      >
                        {item.rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate text-on-surface">{item.name}</span>
                          <span className="shrink-0 text-[10.5px] px-1.5 py-0.5 rounded bg-surface-3/70 text-on-surface-2">
                            {item.vendor}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-surface-3/80 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/80"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-10 text-right font-semibold tabular-nums text-[12.5px] text-on-surface shrink-0">
                        {item.score.toFixed(1)}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        ) : imageFailed ? (
          <p className="py-8 text-[13px] text-on-surface-2 text-center" role="status">
            榜单图片暂时无法加载，请点击右上角切换「列表」视图或查看 Artificial Analysis 官网榜单。
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
