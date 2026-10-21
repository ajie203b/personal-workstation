import { useMemo } from 'react'
import { Check, History, RotateCcw } from 'lucide-react'
import { useAllTasks, deriveDone } from '@/db/hooks'
import { deleteTask, toggleDone } from '@/db/tasks'
import type { Task } from '@/db/db'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { HoldToConfirm } from '@/shared/ui/HoldToConfirm'
import { useUi } from '@/stores/ui'
import { parseDateStr, todayStr, toDateStr, WEEKDAY_CN } from '@/lib/date'

/** Logbook 日志：完成的任务自动归档，按日期分组，可恢复 / 删除 */
export function LogbookView() {
  const all = useAllTasks()
  const done = useMemo(() => deriveDone(all), [all])
  const toast = useUi((s) => s.toast)

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of done) {
      const day = toDateStr(new Date(t.doneAt ?? t.updatedAt))
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(t)
    }
    return [...map.entries()]
  }, [done])

  const dayLabel = (day: string) => {
    const today = todayStr()
    if (day === today) return '今天'
    if (day === toDateStr(new Date(Date.now() - 86400000))) return '昨天'
    const d = parseDateStr(day)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_CN[d.getDay()]}`
  }

  if (done.length === 0) {
    return <EmptyState icon={History} title="日志还是空的" hint="完成的任务会自动归档在这里，作为你的 Logbook。" />
  }

  return (
    <div className="flex flex-col gap-5 enter">
      <div className="flex items-center justify-between px-1">
        <p className="text-[13px] text-on-surface-2">共 {done.length} 条已完成 · 归档即安心</p>
        <HoldToConfirm
          holdMs={1200}
          label="清空日志"
          className="h-8 px-3"
          dialogTitle="清空日志？"
          dialogDescription={`将永久删除 ${done.length} 条已完成记录，不可撤销。`}
          onConfirm={() => void Promise.all(done.map((t) => deleteTask(t))).then(() => toast('日志已清空'))}
        />
      </div>

      {groups.map(([day, tasks]) => (
        <section key={day}>
          <h2 className="text-[13px] font-semibold text-on-surface-2 px-1 mb-2">{dayLabel(day)}</h2>
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <div key={t.id} className="card px-4 py-2.5 flex items-center gap-3">
                <span className="grid place-items-center w-[22px] h-[22px] rounded-full bg-ok text-on-primary shrink-0" aria-hidden>
                  <Check size={13} strokeWidth={3} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] line-through text-on-surface-2 truncate">{t.title}</p>
                  <p className="text-[11px] text-on-surface-2/70 mt-0.5">
                    {new Date(t.doneAt ?? t.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 完成
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { void toggleDone(t); toast('已恢复任务') }}
                  aria-label="恢复任务"
                >
                  <RotateCcw size={14} /> 恢复
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}

    </div>
  )
}
