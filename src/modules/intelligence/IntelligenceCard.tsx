import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import type { IntelData } from '@/lib/intelligence'
import { getLastIntelFetch, loadCachedIntel, refreshIntel } from '@/lib/intelligence'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'

/** 与官方图相近的冷暖混排色板（按名次循环，稳定可复现） */
const PALETTE = [
  '#C17A5B', '#B96A4D', '#3B82F6', '#C17A5B', '#111827', '#22A06B', '#3B82F6', '#111827',
  '#8B5CF6', '#F97316', '#F97066', '#2563EB', '#06B6D4', '#2563EB', '#C48A72', '#EC4899',
  '#3B82F6', '#22A06B', '#0EA5E9', '#EF4444', '#111827', '#F97316', '#1D4ED8', '#15803D',
  '#84CC16', '#737373', '#A3A3A3',
]

/**
 * 模型智能排名卡（v2.1）：
 * 有每日更新的数据就按数据画柱状榜；没有就用内置快照图。两种形态都放在横向滚动容器里，
 * 手机上左右滑动查看，不会把页面撑宽。
 */
export function IntelligenceCard() {
  const toast = useUi((s) => s.toast)
  const [data, setData] = useState<IntelData | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void getLastIntelFetch().then((t) => { if (alive) setAt(t) })
    void loadCachedIntel().then((d) => { if (alive && d) setData(d) })
    void refreshIntel().then((d) => {
      if (!alive) return
      if (d) {
        setData(d)
        void getLastIntelFetch().then((t) => { if (alive) setAt(t) })
      }
    })
    return () => { alive = false }
  }, [])

  const manualRefresh = async () => {
    if (busy) return
    setBusy(true)
    const next = await refreshIntel(true)
    setBusy(false)
    if (next) {
      setData(next)
      setAt(Date.now())
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
            Artificial Analysis{data?.indexVersion ? ` · ${data.indexVersion}` : ''}
            {at ? ` · 更新于 ${new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}` : ' · 内置快照'}
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

      {/* 横向滑动：内容比屏幕宽时左右拖动，纵向仍可滚页面 */}
      <div className="overflow-x-auto overscroll-x-contain -mx-1 px-1 pb-1" style={{ touchAction: 'pan-x pan-y' }}>
        {data ? (
          <Bars data={data} />
        ) : (
          <img
            src={`${import.meta.env.BASE_URL}intelligence/seed.png`}
            alt="Artificial Analysis 智能指数排名"
            draggable={false}
            className="h-[300px] w-auto max-w-none rounded-[10px] select-none"
          />
        )}
      </div>
      <p className="text-[11px] text-on-surface-2 mt-2">左右滑动看完整榜单 · 每日自动更新</p>
    </section>
  )
}

function Bars({ data }: { data: IntelData }) {
  const max = Math.max(...data.models.map((m) => m.score), 1)
  return (
    <div className="flex items-end gap-2 min-w-max h-[320px] pl-1 pr-4">
      {data.models.map((m, i) => (
        <div key={`${m.name}-${i}`} className="flex flex-col items-center shrink-0" style={{ width: 56 }}>
          <div
            className="relative w-10 rounded-t-[3px] flex justify-center"
            style={{ height: Math.max(26, Math.round((m.score / max) * 220)), background: PALETTE[i % PALETTE.length] }}
          >
            <span className="text-[11px] text-white/95 font-medium mt-1 tabular-nums">{Math.round(m.score)}</span>
          </div>
          <span
            className="mt-2 h-[96px] text-[10.5px] leading-tight text-on-surface-2 whitespace-nowrap overflow-hidden text-ellipsis"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            title={m.name}
          >
            {m.name}
          </span>
        </div>
      ))}
    </div>
  )
}
