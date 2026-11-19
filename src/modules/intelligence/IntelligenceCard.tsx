import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2, RefreshCw, Sparkles, X } from 'lucide-react'
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

/** 保留 Artificial Analysis 官方图表原图，支持横向查看、大图弹窗预览与即时刷新。 */
export function IntelligenceCard() {
  const toast = useUi((s) => s.toast)
  const [dragging, setDragging] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [fitWidth, setFitWidth] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const mountedRef = useRef(true)
  // 内置图保证离线/弱网立即有画面；远端最新图加载成功后再替换
  const localChart = `${import.meta.env.BASE_URL}intelligence/chart.png`
  const localMeta = `${import.meta.env.BASE_URL}intelligence/chart-meta.json`
  const [chartSrc, setChartSrc] = useState(localChart)

  const loadLatestChart = useCallback(async (manual: boolean, signal?: AbortSignal) => {
    setRefreshing(true)
    try {
      let bestUrl = ''
      let bestUpdatedAt = ''
      let bestTs = -1

      // 优先读取国内直连源（GitHub Pages），失败再回退 raw；每次带新鲜参数绕过整日缓存
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
        // 主源已拿到带元数据的最新图则直接采用，避免国内环境等待备选源超时
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

  return (
    <section className="card p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-primary-soft text-primary shrink-0">
          <Sparkles size={17} aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold">模型智能排名</h2>
          <p className="text-[12px] text-on-surface-2 mt-0.5 truncate">
            Artificial Analysis 官方图表{formatUpdatedAt(updatedAt) ? ` · 更新于 ${formatUpdatedAt(updatedAt)}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label="刷新模型排名图表"
          title="立即刷新榜单"
          disabled={refreshing}
          onClick={() => void loadLatestChart(true)}
          className="grid place-items-center size-10 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors shrink-0 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw size={15} aria-hidden className={cn(refreshing && 'animate-spin')} />
        </button>
        <a
          href="https://artificialanalysis.ai/leaderboards/models"
          rel="noopener noreferrer"
          aria-label="打开 Artificial Analysis 官网榜单"
          title="查看官网榜单"
          onClick={(e) => { e.preventDefault(); openExternal('https://artificialanalysis.ai/leaderboards/models') }}
          className="grid place-items-center size-10 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors shrink-0"
        >
          <ExternalLink size={15} aria-hidden />
        </a>
      </div>
      {imageFailed ? (
        <p className="py-8 text-[13px] text-on-surface-2" role="status">榜单图片暂时无法加载，请通过右上角入口查看官网榜单。</p>
      ) : (
        <div className="rounded-[12px] bg-[#f8f9fb] p-2 ring-1 ring-black/5">
          <div
            role="region"
            aria-label="模型排名图表，可左右滑动或用方向键滚动"
            tabIndex={0}
            className="overflow-x-auto overscroll-x-contain pb-1 rounded-[8px] cursor-grab active:cursor-grabbing select-none"
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
              onError={() => {
                // 远程图失效就退回内置图；内置图也失败才显示提示
                if (chartSrc !== localChart) setChartSrc(localChart)
                else setImageFailed(true)
              }}
              className="h-[min(300px,44dvh)] w-auto max-w-none rounded-[8px] select-none pointer-events-none"
            />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-[12px] text-on-surface-2 mt-2.5">
        <span className="min-w-0 truncate">
          {dragging ? '拖动中…' : '左右滑动查看榜单 · 图源 Artificial Analysis'}
        </span>
        <a
          href={chartSrc}
          rel="noopener noreferrer"
          onClick={openOriginal}
          className="inline-flex items-center gap-1 px-2 py-1.5 -mr-2 rounded-[8px] text-primary hover:bg-primary-soft/60 transition-colors shrink-0"
        >
          查看原图 <Maximize2 size={12} aria-hidden />
        </a>
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-3 sm:p-6 cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label="模型排名图表原图"
          onClick={() => setZoomed(false)}
        >
          <div
            className="w-full max-w-[94vw] flex items-center justify-end gap-2 mb-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setFitWidth((v) => !v)}
              className="px-3 h-8 rounded-full bg-white/15 text-white text-[12px] hover:bg-white/25 transition-colors cursor-pointer"
            >
              {fitWidth ? '原图横向滚动' : '适应屏幕宽度'}
            </button>
            {!isNative() && (
              <button
                type="button"
                onClick={() => openExternal(chartSrc)}
                className="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-white/15 text-white text-[12px] hover:bg-white/25 transition-colors cursor-pointer"
              >
                新窗口打开 <ExternalLink size={12} aria-hidden />
              </button>
            )}
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setZoomed(false)}
              className="grid place-items-center w-8 h-8 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div
            className="max-w-[94vw] max-h-[82dvh] overflow-auto rounded-[12px] bg-[#f8f9fb] p-2.5 shadow-2xl ring-1 ring-black/10 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={chartSrc}
              alt="Artificial Analysis 模型智能指数排名官方原图"
              className={cn(
                'rounded-[8px] select-none',
                fitWidth ? 'w-full h-auto max-h-[76dvh] object-contain' : 'h-[min(480px,68dvh)] w-auto max-w-none',
              )}
              draggable={false}
            />
          </div>
        </div>
      )}
    </section>
  )
}
