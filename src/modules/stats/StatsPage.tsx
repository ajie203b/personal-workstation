import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Flame, Highlighter, Timer } from 'lucide-react'
import { db } from '@/db/db'
import { migrateLegacyFocusRecords } from '@/db/focus'
import { cn } from '@/lib/cn'

/** 统计页（v1.3）：完成热力图 + 周报 + 标签分布 + 专注排行。全部本地数据。 */

type Metric = 'tasks' | 'focus' | 'notes'

const METRIC_LABEL: Record<Metric, string> = { tasks: '任务', focus: '专注', notes: '批注' }

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 从今天往回数的连续完成天数 */
function calcStreak(doneDays: Set<string>): number {
  let streak = 0
  const cur = new Date()
  if (!doneDays.has(dayKey(cur))) cur.setDate(cur.getDate() - 1) // 今天还没打卡不断签
  for (;;) {
    if (!doneDays.has(dayKey(cur))) break
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
    for (const t of doneTasks) bump(dayKey(new Date(t.doneAt!)), 'tasks')
    for (const s of sessions ?? []) bump(s.day, 'focus', s.minutes)
    for (const a of annotations ?? []) bump(dayKey(new Date(a.createdAt)), 'notes')
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
        const key = dayKey(day)
        col.push({ key, count: dayCounts[key]?.[metric] ?? 0, date: day })
      }
      cols.push(col)
    }
    return cols
  }, [dayCounts, metric])

  const maxCount = useMemo(() => Math.max(1, ...weeks.flat().map((c) => c.count)), [weeks])

  // 本周 vs 上周（周一起算）
  const weekCompare = useMemo(() => {
    const thisMon = mondayOf(new Date())
    const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7)
    const sum = (from: Date, days: number, m: Metric) => {
      let total = 0
      for (let i = 0; i < days; i++) {
        const d = new Date(from); d.setDate(d.getDate() + i)
        total += dayCounts[dayKey(d)]?.[m] ?? 0
      }
      return total
    }
    const dow = ((new Date().getDay() + 6) % 7) + 1
    return (['tasks', 'focus', 'notes'] as Metric[]).map((m) => ({
      metric: m,
      thisWeek: sum(thisMon, dow, m),
      lastWeek: sum(lastMon, 7, m),
    }))
  }, [dayCounts])

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
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <div>
        <h1 className="text-[22px] font-bold leading-8">统计</h1>
        <p className="text-[13px] text-on-surface-2 mt-0.5">全部来自本机历史数据 · 完成打卡 / 专注 / 批注</p>
      </div>

      {/* 概览四卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<CheckCircle2 size={16} />} label="累计完成" value={String(doneTasks.length)} unit="件" />
        <StatCard icon={<Flame size={16} />} label="连续打卡" value={String(streak)} unit="天" accent="var(--p0)" />
        <StatCard icon={<Timer size={16} />} label="专注总时长" value={String(Math.round(totalFocus / 60 * 10) / 10)} unit="小时" accent="var(--ok)" />
        <StatCard icon={<Highlighter size={16} />} label="批注总数" value={String(annotations.length)} unit="条" />
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
              <div key={wi} className="flex flex-col gap-[3px]">
                {col.map((cell) => (
                  <span
                    key={cell.key}
                    title={`${cell.key} · ${cell.count} ${METRIC_LABEL[metric]}`}
                    className="w-[13px] h-[13px] rounded-[3px] shrink-0"
                    style={{
                      background:
                        cell.count === 0
                          ? 'var(--surface-3)'
                          : `color-mix(in srgb, ${metric === 'focus' ? 'var(--ok)' : 'var(--primary)'} ${Math.round(20 + (cell.count / maxCount) * 80)}%, transparent)`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-on-surface-2 mt-2">颜色越深，当天{METRIC_LABEL[metric] === '专注' ? '专注分钟' : METRIC_LABEL[metric] + '数'}越多</p>
      </div>

      {/* 周报对比 */}
      <div className="card p-4">
        <h2 className="text-[14px] font-semibold mb-3">本周 vs 上周</h2>
        <div className="grid grid-cols-3 gap-3">
          {weekCompare.map(({ metric: m, thisWeek, lastWeek }) => {
            const delta = thisWeek - lastWeek
            const focusMode = m === 'focus'
            return (
              <div key={m} className="rounded-[12px] bg-surface-2 px-3 py-3 text-center">
                <p className="text-[12px] text-on-surface-2">{METRIC_LABEL[m]}{focusMode ? '（分钟）' : ''}</p>
                <p className="text-[22px] font-bold tabular-nums mt-1">{thisWeek}</p>
                <p className={cn('text-[11px] mt-0.5 tabular-nums', delta > 0 ? 'text-ok' : delta < 0 ? 'text-on-surface-2' : 'text-on-surface-2/60')}>
                  {delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '— 持平'} · 上周 {lastWeek}
                </p>
              </div>
            )
          })}
        </div>
      </div>

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

function StatCard({ icon, label, value, unit, accent }: { icon: React.ReactNode; label: string; value: string; unit: string; accent?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-on-surface-2">
        <span style={accent ? { color: accent } : undefined}>{icon}</span>
        {label}
      </span>
      <span className="text-[24px] font-bold tabular-nums leading-none">
        {value}
        <span className="text-[12px] font-normal text-on-surface-2 ml-1">{unit}</span>
      </span>
    </div>
  )
}
