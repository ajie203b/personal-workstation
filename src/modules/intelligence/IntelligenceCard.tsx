import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Maximize2, Sparkles, X } from 'lucide-react'
import { openExternal } from '@/lib/links'
import { isNative } from '@/lib/native'

/** 保留 Artificial Analysis 官方图表原图，支持横向查看及打开完整图片。 */
export function IntelligenceCard() {
  const [dragging, setDragging] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const dragRef = useRef<{ x: number; left: number } | null>(null)
  const chartUrl = `${import.meta.env.BASE_URL}intelligence/chart.png`

  // 安卓壳里「查看原图」不能开新窗（window.open / target=_blank 都没人接，静默失败），
  // 同窗跳到 https://localhost/... 又会把 SPA 顶掉——就地放大最稳
  const openOriginal = (e: { preventDefault: () => void }) => {
    if (isNative()) {
      e.preventDefault()
      setZoomed(true)
      return
    }
    e.preventDefault()
    openExternal(chartUrl)
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
          className="grid place-items-center w-8 h-8 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors shrink-0"
        >
          <ExternalLink size={15} aria-hidden />
        </a>
      </div>
      {imageFailed ? (
        <p className="py-8 text-[13px] text-on-surface-2" role="status">榜单图片暂时无法加载，请通过右上角入口查看官网榜单。</p>
      ) : (
        <div
          role="region"
          aria-label="模型排名图表，可左右滑动或用方向键滚动"
          tabIndex={0}
          className="overflow-x-auto overscroll-x-contain pb-1 rounded-[10px] cursor-grab active:cursor-grabbing select-none"
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
            src={chartUrl}
            alt="Artificial Analysis 模型智能指数排名官方原图"
            width={1767}
            height={415}
            draggable={false}
            onError={() => setImageFailed(true)}
            className="h-[300px] w-auto max-w-none rounded-[10px] select-none pointer-events-none"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-on-surface-2 mt-3">
        <span>{dragging ? '拖动中…' : '左右滑动或拖动查看完整榜单'} · 图源 Artificial Analysis</span>
        <a
          href={chartUrl}
          rel="noopener noreferrer"
          onClick={openOriginal}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          查看原图 <Maximize2 size={12} aria-hidden />
        </a>
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4 cursor-zoom-out"
          role="dialog"
          aria-label="模型排名图表原图"
          onClick={() => setZoomed(false)}
        >
          <button
            aria-label="关闭"
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 grid place-items-center w-9 h-9 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors"
          >
            <X size={18} aria-hidden />
          </button>
          <img
            src={chartUrl}
            alt="Artificial Analysis 模型智能指数排名官方原图"
            className="max-w-full max-h-full rounded-[10px] shadow-2xl"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  )
}