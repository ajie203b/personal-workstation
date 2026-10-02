import { useEffect, useState } from 'react'
import { aggregateUsage, type UsageAggregate } from '@/db/ai'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Activity } from 'lucide-react'

const DONUT_COLORS = ['#0B57D0', '#22A06B', '#F5A623', '#E5484D', '#9CA3AF', '#7C5CFF']
const MODULE_LABEL: Record<string, string> = { chat: '直接对话', task: '来自任务', doc: '来自文档' }

/** 用量仪表盘（方案 2.3）：花费 / Tokens / 请求数 / 平均延迟，按模型与模块下钻，轻量 SVG 图表 */
export function UsageDashboard() {
  const [agg, setAgg] = useState<UsageAggregate | null>(null)
  useEffect(() => {
    void aggregateUsage(30).then(setAgg)
    const t = setInterval(() => void aggregateUsage(30).then(setAgg), 8000)
    return () => clearInterval(t)
  }, [])

  if (!agg) return <div className="flex-1 grid place-items-center text-on-surface-2 text-[13px]">统计中…</div>
  if (agg.requests === 0) {
    return (
      <div className="flex-1 grid place-items-center min-h-0">
        <EmptyState icon={Activity} title="最近 30 天还没有用量" hint="发起一次对话后，这里会展示花费、Token、请求数与延迟的四指标下钻。" />
      </div>
    )
  }

  const totalTokens = agg.tokensIn + agg.tokensOut
  return (
    <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-3.5">
      {/* 四指标 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="花费" value={`$${agg.cost.toFixed(4)}`} />
        <Kpi label="Tokens" value={formatNum(totalTokens)} sub={`入 ${formatNum(agg.tokensIn)} / 出 ${formatNum(agg.tokensOut)}`} />
        <Kpi label="请求数" value={String(agg.requests)} />
        <Kpi label="平均延迟" value={`${(agg.avgLatency / 1000).toFixed(2)}s`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 模型占比环形图 */}
        <section className="card p-4">
          <h2 className="text-[13px] font-semibold text-on-surface-2 mb-3">模型占比（Tokens）</h2>
          <Donut
            data={agg.byModel.slice(0, 6).map((m) => ({ label: m.model, value: m.tokens }))}
            center={{ top: formatNum(totalTokens), bottom: 'Tokens' }}
          />
          <div className="flex flex-col gap-1.5 mt-3">
            {agg.byModel.slice(0, 6).map((m, i) => (
              <div key={m.model} className="flex items-center gap-2 text-[12px]">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="font-mono truncate flex-1">{m.model}</span>
                <span className="text-on-surface-2 tabular-nums">{formatNum(m.tokens)}</span>
                {m.cost > 0 && <span className="text-on-surface-2 tabular-nums w-16 text-right">${m.cost.toFixed(4)}</span>}
              </div>
            ))}
          </div>
        </section>

        {/* 日趋势 */}
        <section className="card p-4">
          <h2 className="text-[13px] font-semibold text-on-surface-2 mb-3">每日趋势（Tokens）</h2>
          <Bars data={agg.byDay.map((d) => ({ label: d.day, value: d.tokens }))} />
        </section>
      </div>

      {/* 按模块下钻 */}
      <section className="card p-4">
        <h2 className="text-[13px] font-semibold text-on-surface-2 mb-3">按来源模块</h2>
        <div className="flex flex-col gap-2.5">
          {agg.byModule.map((m) => (
            <div key={m.module} className="flex items-center gap-3 text-[13px]">
              <span className="w-16 shrink-0">{MODULE_LABEL[m.module] ?? m.module}</span>
              <span className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.round((m.tokens / totalTokens) * 100)}%` }}
                />
              </span>
              <span className="text-[11.5px] text-on-surface-2 tabular-nums w-36 text-right">
                {m.requests} 次 · {formatNum(m.tokens)} tok{m.cost > 0 ? ` · $${m.cost.toFixed(4)}` : ''}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3">
      <b className="block text-[20px] leading-7 font-bold text-primary tabular-nums">{value}</b>
      <span className="text-[11.5px] text-on-surface-2">{label}</span>
      {sub && <span className="block text-[10.5px] text-on-surface-2 mt-0.5">{sub}</span>}
    </div>
  )
}

/** 轻量 SVG 环形图（无第三方图表库） */
function Donut({ data, center }: { data: { label: string; value: number }[]; center: { top: string; bottom: string } }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const R = 52
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="relative w-[136px] h-[136px] mx-auto">
      <svg viewBox="0 0 136 136" className="w-full h-full -rotate-90">
        <circle cx="68" cy="68" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
        {data.map((d, i) => {
          const frac = d.value / total
          const dash = `${frac * C} ${C}`
          const offset = -acc * C
          acc += frac
          return (
            <circle
              key={d.label}
              cx="68" cy="68" r={R} fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeDashoffset={offset}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-[16px] font-bold leading-5">{center.top}</b>
          <span className="text-[10.5px] text-on-surface-2">{center.bottom}</span>
        </div>
      </div>
    </div>
  )
}

/** 轻量 SVG 柱状趋势 */
function Bars({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <p className="text-[12px] text-on-surface-2 text-center py-6">暂无数据</p>
  const max = Math.max(...data.map((d) => d.value)) || 1
  return (
    <div>
      <div className="flex items-end gap-1.5 h-[120px]">
        {data.slice(-14).map((d) => (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-1 group relative min-w-0">
            <span className="text-[9px] text-on-surface-2 opacity-0 group-hover:opacity-100 absolute -top-4 tabular-nums whitespace-nowrap">
              {formatNum(d.value)}
            </span>
            <div
              className="w-full rounded-t-[4px] bg-primary/80 min-h-[3px] transition-all"
              style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {data.slice(-14).map((d) => (
          <span key={d.label} className="flex-1 text-center text-[9px] text-on-surface-2 truncate">{d.label}</span>
        ))}
      </div>
    </div>
  )
}

function formatNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(Math.round(n))
}
