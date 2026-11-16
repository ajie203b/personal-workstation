import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2, Sparkles, X } from 'lucide-react'
import { openExternal } from '@/lib/links'
import { isNative } from '@/lib/native'
import { INTEL_CHART_URLS } from '@/lib/intelSources'
import { cn } from '@/lib/cn'

/** 保留 Artificial Analysis 官方图表原图，支持横向查看及大图弹窗预览。 */
export function IntelligenceCard() {
  const [dragging, setDragging] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [fitWidth, setFitWidth] = useState(false)
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  // 内置图保证离线/弱网立即有画面；每日 Action 提交的新图加载成功后再替换
  const localChart = `${import.meta.env.BASE_URL}intelligence/chart.png`
  const [chartSrc, setChartSrc] = useState(localChart)

  useEffect(() => {
    let cancelled = false
    const day = new Date().toISOString().slice(0, 10)
    const tryAt = (index: number) => {
      if (cancelled || index >= INTEL_CHART_URLS.length) return
      const url = `${INTEL_CHART_URLS[index]}?v=${day}`
      const probe = new Image()
      probe.onload = () => {
        if (cancelled) return
        setImageFailed(false)
        setChartSrc(url)
      }
      probe.onerror = () => tryAt(index + 1)
      probe.src = url
    }
    tryAt(0)
    return () => { cancelled = true }
  }, [])

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
          <p className="text-[12px] text-on-surface-2 mt-0.5">Artificial Analysis 官方图表</p>
        </div>
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
