import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import type { IntelData } from '@/lib/intelligence'
import { getLastIntelFetch, loadCachedIntel, refreshIntelDetailed } from '@/lib/intelligence'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'

/**
 * 模型智能排名卡（v2.1，3.0.1 改）：
 * **直接展示 Artificial Analysis 官方的图表原图**，不再用数据自绘柱状图——
 * 自己画的版本既没有官方配色/厂商标识，也容易被误认为是官方图。
 *
 * 图下方的数据（榜首与日期）来自每日 Action 生成的 intelligence.json，
 * 只用来标注"现在榜首是谁、什么时候对齐的"，不参与绘图。
 */
export function IntelligenceCard() {
  const toast = useUi((s) => s.toast)
  const [data, setData] = useState<IntelData | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; left: number } | null>(null)

  useEffect(() => {
    let alive = true
    void getLastIntelFetch().then((t) => { if (alive) setAt(t) })
    void loadCachedIntel().then((d) => { if (alive && d) setData(d) })
    void refreshIntelDetailed().then((r) => {
      if (!alive || !r.data) return
      setData(r.data)
      // 只有真从远端取到才刷新「更新于」；用缓存时保持原来的时间，别把旧数据标成今天
      if (r.fetched) void getLastIntelFetch().then((t) => { if (alive) setAt(t) })
    })
    return () => { alive = false }
  }, [])

  const manualRefresh = async () => {
    if (busy) return
    setBusy(true)
    const r = await refreshIntelDetailed(true)
    setBusy(false)
    if (r.data) setData(r.data)
    if (r.fetched) {
      void getLastIntelFetch().then((t) => setAt(t))
      toast('排名已更新')
    } else {
      toast('暂时拉不到新数据，继续显示当前榜单')
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-primary-soft text-primary shrink-0">
          <Sparkles size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-semibold">模型智能排名</h2>
          <p className="text-[11.5px] text-on-surface-2 mt-0.5 truncate">
            Artificial Analysis
            {data?.models[0] ? ` · 榜首 ${data.models[0].name}` : ''}
            {/* 日期是数据对齐的时间，不是图片生成时间，别混着说 */}
            {data && at ? ` · 数据 ${new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void manualRefresh()}
          aria-label="刷新排名"
          title="刷新排名"
          className="grid place-items-center w-8 h-8 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw size={15} className={cn(busy && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={() => window.open('https://artificialanalysis.ai/', '_blank')}
          aria-label="打开 Artificial Analysis"
          title="打开 Artificial Analysis"
          className="grid place-items-center w-8 h-8 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer shrink-0"
        >
          <ExternalLink size={15} />
        </button>
      </div>

      {/* 横向滑动：触屏左右滑，桌面按住拖动（不再只靠底部滚动条） */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overscroll-x-contain -mx-1 px-1 pb-1 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') return
          const el = scrollRef.current
          if (!el) return
          dragRef.current = { x: e.clientX, left: el.scrollLeft }
          setDragging(true)
          el.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const el = scrollRef.current
          const d = dragRef.current
          if (!el || !d) return
          e.preventDefault()
          el.scrollLeft = d.left - (e.clientX - d.x)
        }}
        onPointerUp={(e) => {
          if (!dragRef.current) return
          dragRef.current = null
          setDragging(false)
          scrollRef.current?.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false) }}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* 官方图表原图：不重绘、不加自己的坐标轴，横向滚动看完整榜单 */}
        <img
          src={`${import.meta.env.BASE_URL}intelligence/chart.png`}
          alt="Artificial Analysis 智能指数排名（官方图表）"
          draggable={false}
          className="h-[300px] w-auto max-w-none rounded-[10px] select-none pointer-events-none"
        />
      </div>
      <p className="text-[11px] text-on-surface-2 mt-2">
        {dragging ? '拖动中…' : '按住拖动或左右滑动看完整榜单'} · 图源 artificialanalysis.ai
      </p>
    </section>
  )
}
