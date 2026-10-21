import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Flame, Highlighter, Timer } from 'lucide-react'
import { db } from '@/db/db'
import { migrateLegacyFocusRecords } from '@/db/focus'
import { cn } from '@/lib/cn'
import { toDateStr } from '@/lib/date'
import { durMs, prefersReducedMotion } from '@/lib/motion'

/** 统计页（v1.3）：完成热力图 + 周报 + 标签分布 + 专注排行。全部本地数据。 */

type Metric = 'tasks' | 'focus' | 'notes'

const METRIC_LABEL: Record<Metric, string> = { tasks: '任务', focus: '专注', notes: '批注' }

/** 从今天往回数的连续完成天数 */
function calcStreak(doneDays: Set<string>): number {
  let streak = 0
  const cur = new Date()
  if (!doneDays.has(toDateStr(cur))) cur.setDate(cur.getDate() - 1) // 今天还没打卡不断签
  for (;;) {
    if (!doneDays.has(toDateStr(cur))) break
    streak++
    cur.setDate(cur.getDate() - 1)
  }
  return streak
}

function mondayOf(d: Date): Date {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7 // 周一=0
  x.setDate(x.getDate() - dow)
  x.setHours(0, 0, 0, 0)
  return x
}

export function StatsPage() {
  const [metric, setMetric] = useState<Metric>('tasks')
  /** 顶部「周 / 月」统一控制对比卡与专注走势 */
  const [range, setRange] = useState<'week' | 'month'>('week')

  useEffect(() => { void migrateLegacyFocusRecords() }, [])

  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [])
  const sessions = useLiveQuery(() => db.focusSessions.toArray(), [], [])
  const annotations = useLiveQuery(() => db.annotations.toArray(), [], [])

  const doneTasks = useMemo(() => (tasks ?? []).filter((t) => t.status === 'done' && t.doneAt), [tasks])

  // 日聚合
  const dayCounts = useMemo(() => {
    const map: Record<string, { tasks: number; focus: number; notes: number }> = {}
    const bump = (k: string, m: Metric, n = 1) => {
      map[k] = map[k] ?? { tasks: 0, focus: 0, notes: 0 }
      map[k][m] += n
    }
    for (const t of doneTasks) bump(toDateStr(new Date(t.doneAt!)), 'tasks')
    for (const s of sessions ?? []) bump(s.day, 'focus', s.minutes)
    for (const a of annotations ?? []) bump(toDateStr(new Date(a.createdAt)), 'notes')
    return map
  }, [doneTasks, sessions, annotations])

  const doneDays = useMemo(() => new Set(Object.keys(dayCounts).filter((k) => dayCounts[k].tasks > 0)), [dayCounts])
  const streak = useMemo(() => calcStreak(doneDays), [doneDays])

  // 热力图：最近 26 周
  const weeks = useMemo(() => {
    const end = mondayOf(new Date())
    const cols: { key: string; count: number; date: Date }[][] = []
    for (let w = 25; w >= 0; w--) {
      const start = new Date(end)
      start.setDate(start.getDate() - w * 7)
      const col: { key: string; count: number; date: Date }[] = []
      for (let d = 0; d < 7; d++) {
        const day = new Date(start)
        day.setDate(day.getDate() + d)
        const key = toDateStr(day)
        col.push({ key, count: dayCounts[key]?.[metric] ?? 0, date: day })
      }
      cols.push(col)
    }
    return cols
  }, [dayCounts, metric])

  const maxCount = useMemo(() => Math.max(1, ...weeks.flat().map((c) => c.count)), [weeks])

  // 本周 vs 上周 / 本月 vs 上月（周一起算）
  const compare = useMemo(() => {
    const now = new Date()
    const sumDays = (from: Date, days: number, m: Metric) => {
      let total = 0
      for (let i = 0; i < days; i++) {
        const d = new Date(from); d.setDate(d.getDate() + i)
        total += dayCounts[toDateStr(d)]?.[m] ?? 0
      }
      return total
    }
    if (range === 'month') {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const lStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
      const elapsed = now.getDate()
      return (['tasks', 'focus', 'notes'] as Metric[]).map((m) => ({
        metric: m,
        current: sumDays(mStart, elapsed, m),
        previous: sumDays(lStart, lDays, m),
      }))
    }
    const thisMon = mondayOf(now)
    const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7)
    const dow = ((now.getDay() + 6) % 7) + 1
    return (['tasks', 'focus', 'notes'] as Metric[]).map((m) => ({
      metric: m,
      current: sumDays(thisMon, dow, m),
      previous: sumDays(lastMon, 7, m),
    }))
  }, [dayCounts, range])

  // 标签分布（完成任务口径）
  const tagRank = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of doneTasks) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [doneTasks])

  // 专注排行（按任务聚合）
  const focusRank = useMemo(() => {
    const byTask = new Map<string, number>()
    let orphan = 0
    for (const s of sessions ?? []) {
      if (s.taskId) byTask.set(s.taskId, (byTask.get(s.taskId) ?? 0) + s.minutes)
      else orphan += s.minutes
    }
    const rows = [...byTask.entries()]
      .map(([id, minutes]) => ({ title: (tasks ?? []).find((t) => t.id === id)?.title ?? '（已删除任务）', minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5)
    return { rows, orphan }
  }, [sessions, tasks])

  const totalFocus = useMemo(() => (sessions ?? []).reduce((s, r) => s + r.minutes, 0), [sessions])

  if (!tasks || !sessions || !annotations) return null

  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 cascade">
      <div className="flex items-center gap-3">
        <div className="hidden md:block">
          <h1 className="text-[22px] font-bold leading-8">统计</h1>
          <p className="text-[13px] text-on-surface-2 mt-0.5">全部来自本机历史数据 · 完成打卡 / 专注 / 批注</p>
        </div>
        {/* 周 / 月 一个开关管全部图表，不用每张卡各切一次 */}
        <div className="ml-auto flex items-center gap-0.5 p-[3px] rounded-[12px] bg-surface-3/70">
          {(['week', 'month'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                'h-8 px-3 rounded-[10px] text-[13px] font-medium transition-colors cursor-pointer',
                range === r ? 'bg-surface text-on-surface shadow-sm' : 'text-on-surface-2 hover:text-on-surface',
              )}
            >
              {r === 'week' ? '周' : '月'}
            </button>
          ))}
        </div>
      </div>

      {/* 概览四卡：手机上一条横滑，第一屏让给图表 */}
      <div className="-mx-4 px-4 md:mx-0 md:px-0 flex gap-3 overflow-x-auto pb-1 snap-x md:grid md:grid-cols-4 md:overflow-visible">
        <div className="snap-start shrink-0 w-[150px] md:w-auto"><StatCard icon={<CheckCircle2 size={16} />} label="累计完成" value={doneTasks.length} unit="件" /></div>
        <div className="snap-start shrink-0 w-[150px] md:w-auto"><StatCard icon={<Flame size={16} />} label="连续打卡" value={streak} unit="天" accent="var(--p0)" /></div>
        <div className="snap-start shrink-0 w-[150px] md:w-auto"><StatCard icon={<Timer size={16} />} label="专注总时长" value={Math.round((totalFocus / 60) * 10) / 10} unit="小时" accent="var(--primary)" decimals={1} /></div>
        <div className="snap-start shrink-0 w-[150px] md:w-auto"><StatCard icon={<Highlighter size={16} />} label="批注总数" value={annotations.length} unit="条" /></div>
      </div>

      {/* 热力图 */}
      <div className="card p-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[14px] font-semibold">近半年热力图</h2>
          <div className="ml-auto flex gap-1">
            {(['tasks', 'focus', 'notes'] as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={cn(
                  'h-7 px-2.5 rounded-full text-[12px] cursor-pointer transition-colors',
                  metric === m ? 'bg-primary text-on-primary font-medium' : 'text-on-surface-2 hover:bg-surface-3',
                )}
              >
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-[3px] w-max">
            <div className="flex flex-col gap-[3px] pt-0 mr-1 text-[9px] text-on-surface-2 select-none">
              {['一', '', '三', '', '五', '', '日'].map((w, i) => (
                <span key={i} className="h-[13px] leading-[13px]">{w}</span>
              ))}
            </div>
            {weeks.map((col, wi) => (
              <div
                key={wi}
                className="flex flex-col gap-[3px]"
                style={{ animation: `fade-in var(--dur-2) var(--ease-standard) both`, animationDelay: `${Math.min(wi * 14, 340)}ms` }}
              >
                {col.map((cell) => (
                  <span
                    key={cell.key}
                    title={`${cell.key} · ${cell.count} ${METRIC_LABEL[metric]}`}
                    className="w-[13px] h-[13px] rounded-[3px] shrink-0 transition-[background] duration-200"
                    style={{
                      background:
                        cell.count === 0
                          ? 'var(--surface-3)'
                          : `color-mix(in srgb, var(--primary) ${Math.round(20 + (cell.count / maxCount) * 80)}%, transparent)`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-on-surface-2 mt-2">颜色越深，当天{METRIC_LABEL[metric] === '专注' ? '专注分钟' : METRIC_LABEL[metric] + '数'}越多</p>
      </div>

      {/* 对比卡：周 / 月由顶部开关决定。切范围时柱子就地变形（改高度做过渡），不重挂重画 */}
      <div className="card p-4">
        <div className="flex items-center mb-3">
          <h2 className="text-[14px] font-semibold">{range === 'week' ? '本周 vs 上周' : '本月 vs 上月'}</h2>
          <p className="ml-auto text-[11px] text-on-surface-2">{range === 'week' ? '本周数据截至今天' : '本月数据截至今天'}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {compare.map(({ metric: m, current, previous }, i) => {
            const delta = current - previous
            const focusMode = m === 'focus'
            return (
              <div key={m} className="rounded-[12px] bg-surface-2 px-3 py-3 text-center">
                <p className="text-[12px] text-on-surface-2">{METRIC_LABEL[m]}{focusMode ? '（分钟）' : ''}</p>
                <p className="text-[22px] font-bold tabular-nums mt-1">{current}</p>
                <p className={cn('text-[11px] mt-0.5 tabular-nums', delta > 0 ? 'text-primary' : 'text-on-surface-2/70')}>
                  {delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '— 持平'} · 上期 {previous}
                </p>
                {/* 两根柱子：本期高亮、上期弱化，入场时从 0 长到各自高度；
                    两边都是 0 时不画柱子，免得空轨道看着像「已经满了」 */}
                <div className="flex items-end justify-center gap-1.5 h-14 mt-2">
                  {current + previous > 0 ? (
                    <>
                      <CompareBar value={current} max={Math.max(current, previous, 1)} delay={i * 60} />
                      <CompareBar value={previous} max={Math.max(current, previous, 1)} delay={i * 60 + 90} muted />
                    </>
                  ) : (
                    <span className="text-[11px] text-on-surface-2/50 self-center">暂无数据</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <FocusTrend range={range} dayCounts={dayCounts} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 标签分布 */}
        <div className="card p-4">
          <h2 className="text-[14px] font-semibold mb-3">常做领域（按完成任务标签）</h2>
          {tagRank.length === 0 ? (
            <p className="text-[12px] text-on-surface-2/70 py-4 text-center">完成的任务还没有标签</p>
          ) : (
            <div className="flex flex-col gap-2">
              {tagRank.map(([tag, n]) => (
                <div key={tag} className="flex items-center gap-2">
                  <span className="text-[12px] text-on-surface-2 w-20 truncate">#{tag}</span>
                  <span className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(n / tagRank[0][1]) * 100}%` }}
                    />
                  </span>
                  <span className="text-[12px] tabular-nums text-on-surface-2">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 专注排行 */}
        <div className="card p-4">
          <h2 className="text-[14px] font-semibold mb-3">专注最多的任务</h2>
          {focusRank.rows.length === 0 && focusRank.orphan === 0 ? (
            <p className="text-[12px] text-on-surface-2/70 py-4 text-center">还没有专注记录，去今日页开一个番茄钟</p>
          ) : (
            <div className="flex flex-col gap-2">
              {focusRank.rows.map((r) => (
                <div key={r.title} className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] truncate">{r.title}</span>
                  <span className="text-[12px] tabular-nums text-on-surface-2">{r.minutes} 分钟</span>
                </div>
              ))}
              {focusRank.rows.length === 0 && focusRank.orphan > 0 && (
                <p className="text-[12px] text-on-surface-2">未绑定任务共 {focusRank.orphan} 分钟</p>
              )}
              {focusRank.rows.length > 0 && focusRank.orphan > 0 && (
                <p className="text-[11px] text-on-surface-2/70">另有未绑定任务的专注 {focusRank.orphan} 分钟</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 数字滚动：500ms rAF 缓动到目标值（reduced-motion 时直接落定） */
function useCountUp(target: number, decimals = 0): string {
  const [val, setVal] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const reduced = prefersReducedMotion()
    if (reduced || target === fromRef.current) {
      fromRef.current = target
      setVal(target)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    // 时长取自令牌，随「减弱动效」一并压平
    const DUR = durMs('--dur-3', 400)
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DUR)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(from + (target - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return val.toFixed(decimals)
}

function StatCard({ icon, label, value, unit, accent, decimals = 0 }: { icon: React.ReactNode; label: string; value: number; unit: string; accent?: string; decimals?: number }) {
  const shown = useCountUp(value, decimals)
  return (
    <div className="card p-4 flex flex-col gap-1.5 h-full">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-on-surface-2">
        <span style={accent ? { color: accent } : undefined}>{icon}</span>
        {label}
      </span>
      <span className="text-[24px] font-bold tabular-nums leading-none">
        {shown}
        <span className="text-[12px] font-normal text-on-surface-2 ml-1">{unit}</span>
      </span>
    </div>
  )
}

/**
 * 对比柱：首次挂载从 0 长到目标高度（scaleY），之后数值变化走 height 过渡 ——
 * 切周/月时柱子是「就地变形」而不是重挂重画，形状连续才看得出前后关系。
 */
function CompareBar({ value, max, delay, muted }: { value: number; max: number; delay: number; muted?: boolean }) {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const pct = Math.max(3, Math.round((value / max) * 100))
  return (
    <span className="w-3 h-full flex items-end rounded-full overflow-hidden bg-surface-3/70">
      <span
        className={cn('w-full rounded-full', muted ? 'bg-on-surface-2/25' : 'bg-primary')}
        style={{
          height: `${pct}%`,
          transform: grown ? 'scaleY(1)' : 'scaleY(0)',
          transformOrigin: 'bottom',
          transition: `transform 420ms cubic-bezier(.22,.61,.36,1) ${delay}ms, height 460ms cubic-bezier(.22,.61,.36,1) ${delay}ms, background-color 300ms linear`,
        }}
      />
    </span>
  )
}

/**
 * 每日专注走势（ui-motion「折线画出来 Line Draw」，带拖动看数）。
 * 折线只画一次：进入 / 切换周月时用 stroke-dashoffset 一笔画出；
 * 手指按住横向拖动，读数跟着走，松手回到最新一天。
 */
function FocusTrend({ range, dayCounts }: { range: 'week' | 'month'; dayCounts: Record<string, { tasks: number; focus: number; notes: number }> }) {
  const n = range === 'week' ? 7 : 30
  const data = useMemo(() => {
    const out: { key: string; v: number; label: string }[] = []
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = toDateStr(d)
      out.push({ key, v: dayCounts[key]?.focus ?? 0, label: `${d.getMonth() + 1}/${d.getDate()}` })
    }
    return out
  }, [n, dayCounts])

  const max = Math.max(1, ...data.map((d) => d.v))
  const W = 600
  const H = 96
  const pad = 6
  const pts = data.map((d, i) => ({
    x: (i / Math.max(1, n - 1)) * W,
    y: H - pad - (d.v / max) * (H - pad * 2),
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  // 一笔画出：先 dashoffset=1，下一帧归零
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    setDrawn(false)
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [range, path])

  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const scrub = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    setHover(Math.round(t * (n - 1)))
  }
  const shown = hover != null ? data[hover] : data[data.length - 1]
  const total = data.reduce((s, d) => s + d.v, 0)

  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-[14px] font-semibold">每日专注</h2>
        <span className="text-[11px] text-on-surface-2">近 {n} 天 · 共 {total} 分钟</span>
        <span className="ml-auto text-[12px] tabular-nums text-on-surface-2">
          {shown.label} · <b className="text-on-surface font-semibold">{shown.v}</b> 分钟
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[96px] touch-pan-y select-none"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') scrub(e.clientX) }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => setHover(null)}
        role="img"
        aria-label={`近 ${n} 天每日专注分钟`}
      >
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray={1}
          style={{ strokeDashoffset: drawn ? 0 : 1, transition: 'stroke-dashoffset 720ms cubic-bezier(.22,.61,.36,1)' }}
        />
        {hover != null && pts[hover] && (
          <>
            <line x1={pts[hover].x} y1={0} x2={pts[hover].x} y2={H} stroke="var(--outline)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={pts[hover].x} cy={pts[hover].y} r="4" fill="var(--primary)" />
          </>
        )}
      </svg>
    </div>
  )
}
