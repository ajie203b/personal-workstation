import { useCallback, useEffect, useRef, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X, Trash2, Plus, ListChecks, Pin, PinOff, Timer, FolderOpen, CalendarClock, ChevronDown, Clock3, Repeat } from 'lucide-react'
import { PRIORITY_VAR, TIERS, TIER_LABEL, type Priority, type SubTask, type Task, type Tier } from '@/db/db'
import { db } from '@/db/db'
import { checkinProgress, postponeTask, updateTask } from '@/db/tasks'
import { createFolder, linkTaskFolder } from '@/db/folders'
import { useLiveQuery } from 'dexie-react-hooks'
import { checkInWithUndo, deleteTaskWithUndo, toggleTaskWithUndo } from './taskActions'
import { HabitTimesField } from './HabitTimesField'
import { useAllTasks } from '@/db/hooks'
import { useTasksUi } from '@/stores/tasks'
import { useUi } from '@/stores/ui'
import { TimePicker } from '@/shared/ui/TimePicker'
import { CheckCircle } from '@/shared/ui/CheckCircle'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { cn } from '@/lib/cn'
import { repeatLabel } from '@/lib/repeat'
import { futureReason, isFutureTask, todayStr } from '@/lib/date'
import { uid } from '@/lib/id'
import { MORPH_NAME, consumeMorph, morphClose } from '@/lib/viewTransition'

const FIELD = 'text-[12px] font-medium text-on-surface-2 mb-1.5 block'

/** 时间戳 → datetime-local 的本地值（YYYY-MM-DDTHH:mm） */
function localDateTimeValue(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const INPUT =
  'w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[14px] outline-none focus:border-primary/70 transition-colors'

/** 任务详情：居中弹窗（点任务卡任意位置打开；完成只走勾选框） */
export function TaskDetail() {
  const { detailId, openDetail } = useTasksUi()
  const task = useAllTasks().find((t) => t.id === detailId) ?? null
  const [tagDraft, setTagDraft] = useState('')
  const [subDraft, setSubDraft] = useState('')
  const [focusMinutes, setFocusMinutes] = useState<number | null>(null)
  // 打卡任务：时间点与次数（受控编辑，次数失焦才落库，避免输入中把 1 写成 12）
  const [habitTimes, setHabitTimes] = useState<string[]>([])
  const [habitCount, setHabitCount] = useState('')
  const folders = useLiveQuery(() => db.folders.toArray(), [], [])
  const folderDocCount = useLiveQuery(
    () => (task?.folderId ? db.docs.where('folderId').equals(task.folderId).count() : 0),
    [task?.folderId],
    0,
  )
  // 标题/笔记本地态 + 400ms 防抖写库 + 关闭/切任务时立即 flush（防丢最后输入）
  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const pendingRef = useRef<{ id: string; title: string; notes: string } | null>(null)

  const flushSave = useCallback(async () => {
    const p = pendingRef.current
    if (!p) return
    pendingRef.current = null
    await updateTask(p.id, { title: p.title, notes: p.notes })
  }, [])

  useEffect(() => {
    if (!detailId) void flushSave()
  }, [detailId, flushSave])
  useEffect(() => {
    if (task) {
      setTitleDraft(task.title)
      setNotesDraft(task.notes ?? '')
      setHabitTimes(task.repeatTimes?.length ? task.repeatTimes : task.dueTime ? [task.dueTime] : [])
      setHabitCount(task.repeatCount && task.repeatCount > 1 ? String(task.repeatCount) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  // 该任务的累计专注分钟（v1.3 专注绑定）
  useEffect(() => {
    setFocusMinutes(null)
    if (!task) return
    void db.focusSessions.where('taskId').equals(task.id).toArray().then((rows) => {
      setFocusMinutes(rows.reduce((s, r) => s + r.minutes, 0))
    })
    // detailId 参与依赖：同一任务重新打开时也要重算累计专注时长
  }, [task?.id, detailId])

  useEffect(() => {
    if (!task || task.id !== detailId) return
    if (titleDraft === task.title && notesDraft === (task.notes ?? '')) { pendingRef.current = null; return }
    pendingRef.current = { id: task.id, title: titleDraft, notes: notesDraft }
    const timer = setTimeout(() => {
      void updateTask(task.id, {
        ...(titleDraft !== task.title ? { title: titleDraft } : {}),
        ...(notesDraft !== (task.notes ?? '') ? { notes: notesDraft } : {}),
      })
      pendingRef.current = null
    }, 400)
    return () => clearTimeout(timer)
  }, [titleDraft, notesDraft, task, detailId])

  // 页面关闭/刷新前 flush
  useEffect(() => {
    const onBeforeUnload = () => flushSave()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); flushSave() }
  }, [flushSave])

  // 在「打开详情」这一刻消费一次性标记：morphOpen/morphClose 在调用前已置位，
  // 据此决定详情容器是否挂转场名（挂名后浏览器的共享元素转场才能接管）。
  // 用 ref 记住上次的 detailId，保证同一次打开只判定一次（StrictMode 双渲染也安全）。
  const morphSeen = useRef<string | null>(null)
  const morphFromCard = useRef(false)
  if (detailId !== morphSeen.current) {
    morphSeen.current = detailId
    morphFromCard.current = detailId ? consumeMorph() : false
  }

  if (!task) return null

  const patch = (p: Partial<Task>) => void updateTask(task.id, p)

  // 开始时间拆成「日期 + 时间」两格：手机上并排一行，桌面也只需一格宽
  const startValue = localDateTimeValue(task.startAt)
  const startDate = startValue.slice(0, 10)
  const startTime = startValue.length >= 16 ? startValue.slice(11, 16) : ''
  const setStart = (date: string, time: string) => {
    if (!date) {
      patch({ startAt: undefined })
      return
    }
    patch({ startAt: new Date(`${date}T${time || '09:00'}`).getTime() })
  }

  /**
   * 完成/恢复：先把未落盘的草稿写库并带进 toggleDone，
   * 否则重复任务生成的下一次会沿用旧标题。完成即归档，顺带关闭详情。
   */
  const completeOrRestore = async () => {
    const wasDone = task.status === 'done'
    const merged: Task = {
      ...task,
      title: titleDraft.trim() || task.title,
      notes: notesDraft.trim() ? notesDraft : undefined,
    }
    if (!wasDone && isFutureTask(merged)) {
      useUi.getState().toast('这是未来任务，到日期后再完成')
      return
    }
    if (!wasDone && (merged.title !== task.title || merged.notes !== task.notes)) {
      pendingRef.current = null
      await updateTask(task.id, { title: merged.title, notes: merged.notes })
    } else {
      await flushSave()
    }
    await toggleTaskWithUndo(merged)
    if (!wasDone) openDetail(null)
  }

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '')
    if (t && !task.tags.includes(t)) patch({ tags: [...task.tags, t] })
    setTagDraft('')
  }

  const setSubtasks = (list: SubTask[]) => patch({ subtasks: list })
  const addSub = () => {
    const t = subDraft.trim()
    if (!t) return
    setSubtasks([...(task.subtasks ?? []), { id: uid(), title: t, done: false }])
    setSubDraft('')
  }
  const toggleSub = (sid: string) =>
    setSubtasks((task.subtasks ?? []).map((s) => (s.id === sid ? { ...s, done: !s.done } : s)))
  const removeSub = (sid: string) => setSubtasks((task.subtasks ?? []).filter((s) => s.id !== sid))
  const doneSubs = (task.subtasks ?? []).filter((s) => s.done).length

  const remove = async () => {
    openDetail(null)
    await deleteTaskWithUndo(task)
  }

  const done = task.status === 'done'
  const future = isFutureTask(task)
  const futureWhy = futureReason(task)
  // 打卡任务：次数没打满前，主按钮是「打卡 +1」而不是归档
  const habit = !!task.repeat
  const { count: habitCountDone, total: habitTotal } = checkinProgress(task)

  const checkIn = async () => {
    await flushSave()
    const merged: Task = {
      ...task,
      title: titleDraft.trim() || task.title,
      notes: notesDraft.trim() ? notesDraft : undefined,
    }
    const willFinish = habitCountDone + 1 >= habitTotal
    await checkInWithUndo(merged)
    if (willFinish) openDetail(null)
  }

  return (
    <RadixDialog.Root
      open
      onOpenChange={(v) =>
        // 关闭时让详情「长回」列表卡片（ESC / 点遮罩 / 关闭按钮都走这里）
        !v && morphClose(() => document.getElementById(`task-${task.id}`), () => openDetail(null))
      }
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30 overlay-fade" />
        <RadixDialog.Content
          data-app-modal="dialog"
          className={cn(
            'dialog-panel pop fixed z-50 flex flex-col bg-surface overflow-hidden',
            // 手机：底部弹出的居中胶囊；桌面：居中宽面板（比右侧抽屉能少滚很多）
            'left-0 right-0 bottom-0 max-h-[92dvh] rounded-t-[20px]',
            // v3.1：加宽到 1040 —— 桌面四列把原来三屏的字段压成一屏
            'md:inset-0 md:m-auto md:h-fit md:w-[min(1040px,96vw)] md:max-h-[92dvh] md:rounded-[20px] md:border md:border-outline',
          )}
          style={{
            // 常挂转场名：打开时若来自卡片则浏览器自动插值形变，关闭时也能「长回」卡片；
            // 不支持 View Transitions 时该属性无副作用。
            viewTransitionName: MORPH_NAME,
            // 由卡片形变而来时抑制自身 scale-in，避免与转场打架；直接打开保留弹簧入场
            animation: morphFromCard.current ? undefined : 'scale-in var(--dur-2) var(--ease-spring)',
          }}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-outline">
            <RadixDialog.Title className="text-[16px] font-semibold">任务详情</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="关闭"
              className="grid place-items-center w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>

          {/* 内容区：桌面四列 —— 标题/笔记横跨整行，其余属性铺开，尽量一屏放下 */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 md:gap-x-4 md:gap-y-3.5">
              <div className="col-span-2 md:col-span-4">
                <label className={FIELD}>标题</label>
                <textarea
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  rows={2}
                  className={cn(INPUT, 'h-auto py-2 resize-none leading-relaxed text-[15px]')}
                />
              </div>

              <div className="col-span-2 md:col-span-4">
                <label className={FIELD}>笔记</label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={2}
                  placeholder="补充说明、链接…"
                  className={cn(INPUT, 'h-auto py-2 resize-none leading-relaxed')}
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <label className={FIELD}>所属清单</label>
                <Segmented
                  size="sm"
                  value={task.tier}
                  onChange={(v) => patch({ tier: v as Tier })}
                  options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <label className={FIELD}>优先级</label>
                <Segmented
                  size="sm"
                  value={String(task.priority)}
                  onChange={(v) => patch({ priority: Number(v) as Priority })}
                  options={([0, 1, 2, 3] as const).map((p) => ({
                    value: String(p),
                    label: ['紧急', '重要', '常规', '低'][p],
                    dot: PRIORITY_VAR[p],
                  }))}
                />
              </div>

              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1.5 gap-1">
                  <label className={cn(FIELD, 'mb-0 truncate')}><span className="inline-flex items-center gap-1.5"><CalendarClock size={13} /> 开始时间</span></label>
                  <button
                    type="button"
                    onClick={() => void postponeTask(task)}
                    className="shrink-0 text-[11.5px] text-primary hover:underline cursor-pointer whitespace-nowrap"
                  >
                    顺延一天
                  </button>
                </div>
                {/* 日期与时间并排：竖着排会让手机详情白白多出两行 */}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="开始日期"
                    value={startDate}
                    onChange={(e) => setStart(e.target.value, startTime)}
                    className={INPUT}
                  />
                  <TimePicker
                    value={startTime}
                    onChange={(t) => setStart(startDate || todayStr(), t ?? '')}
                    placeholder="不设时间"
                    allowClear
                  />
                </div>
              </div>

              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1.5 gap-1">
                  <label className={cn(FIELD, 'mb-0 truncate')}>截止日期 / 时间</label>
                  {!task.due && <span className="shrink-0 text-[10.5px] text-on-surface-2/80" title="没有截止日期 = 无穷远">∞ 无截止</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="截止日期"
                    value={task.due ?? ''}
                    onChange={(e) => patch({ due: e.target.value || undefined })}
                    className={INPUT}
                  />
                  <TimePicker
                    value={task.dueTime}
                    onChange={(v) => patch({ dueTime: v })}
                    placeholder="不设时间"
                    allowClear
                  />
                </div>
              </div>
              {task.repeat && (
                <p className="col-span-2 md:col-span-2 text-[11px] text-on-surface-2 self-end pb-2.5">打卡任务完成后，下一次会沿用这里的时间。</p>
              )}

              <div className="col-span-2">
                <label className={FIELD}><span className="inline-flex items-center gap-1.5"><FolderOpen size={13} /> 资料文件夹</span></label>
                {task.folderId ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openDetail(null)
                        window.location.hash = `#/docs?folder=${task.folderId}`
                      }}
                      className="flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-left text-[13px] hover:border-primary/50 transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <FolderOpen size={14} className="text-on-surface-2 shrink-0" />
                      <span className="truncate">{folders.find((f) => f.id === task.folderId)?.name ?? '文件夹'}</span>
                      <span className="ml-auto text-[11px] text-on-surface-2 shrink-0">{folderDocCount} 篇</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void linkTaskFolder(task.id, undefined)}
                      className="shrink-0 text-[12px] text-on-surface-2 hover:text-danger cursor-pointer px-1"
                    >
                      解除
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => void createFolder(task.title, task.id)}
                    >
                      新建文件夹并关联
                    </Button>
                    {folders.length > 0 && (
                      <div className="relative flex-1 min-w-0">
                        <select
                          aria-label="关联已有文件夹"
                          value=""
                          onChange={(e) => { if (e.target.value) void linkTaskFolder(task.id, e.target.value) }}
                          className={cn(INPUT, 'h-9 appearance-none pr-8')}
                        >
                          <option value="">关联已有文件夹…</option>
                          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-2" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="col-span-2 md:col-span-1">
                <label className={FIELD}>标签</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {task.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patch({ tags: task.tags.filter((x) => x !== t) })}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-surface-3 text-[12px] hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer"
                      title="点击移除"
                    >
                      #{t} ×
                    </button>
                  ))}
                  {task.tags.length === 0 && <span className="text-[13px] text-on-surface-2">无标签</span>}
                </div>
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                  placeholder="输入标签后回车添加"
                  className={INPUT}
                />
              </div>

              {task.repeat && (
                <div className="col-span-2 md:col-span-1">
                  <label className={FIELD}>每周期次数</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    inputMode="numeric"
                    aria-label="每周期打卡次数"
                    value={habitCount}
                    onChange={(e) => setHabitCount(e.target.value)}
                    onBlur={() => {
                      const n = Math.round(Number(habitCount))
                      patch({ repeatCount: habitCount.trim() && Number.isFinite(n) && n > 1 ? Math.min(99, n) : undefined })
                    }}
                    placeholder="1"
                    className={cn(INPUT, 'tabular-nums')}
                  />
                  <p className="text-[10.5px] text-on-surface-2 mt-1">打满才归档；1 = 一次即完成</p>
                </div>
              )}

              {task.repeat && (
                <div className="col-span-2 md:col-span-4">
                  <label className={FIELD}>打卡时间点（可多个）</label>
                  <HabitTimesField
                    value={habitTimes}
                    onChange={(list) => patch({ repeatTimes: list.length > 1 ? list : undefined, dueTime: list[0] })}
                  />
                </div>
              )}

              <div className="col-span-2 md:col-span-4">
                <label className={FIELD}>
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecks size={13} /> 子任务{task.subtasks?.length ? `（${doneSubs}/${task.subtasks.length}）` : ''}
                  </span>
                </label>
                <div className="flex flex-col gap-1 mb-2">
                  {(task.subtasks ?? []).map((s) => (
                    <div key={s.id} className="group flex items-center gap-2 h-9 px-2.5 rounded-[10px] bg-surface-2">
                      <CheckCircle
                        checked={s.done}
                        onChange={() => toggleSub(s.id)}
                        label={s.done ? '取消完成子任务' : '完成子任务'}
                      />
                      <span className={cn('flex-1 text-[13px] truncate', s.done && 'line-through text-on-surface-2')}>{s.title}</span>
                      <button
                        type="button"
                        onClick={() => removeSub(s.id)}
                        aria-label="删除子任务"
                        className="grid place-items-center w-6 h-6 rounded-[8px] text-on-surface-2 hover:text-danger cursor-pointer shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={subDraft}
                    onChange={(e) => setSubDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub() } }}
                    placeholder="添加步骤，回车确认"
                    className={INPUT}
                  />
                  <Button size="sm" onClick={addSub} aria-label="添加子任务" className="shrink-0">
                    <Plus size={15} />
                  </Button>
                </div>
              </div>

              {(task.estimateMinutes != null || (focusMinutes != null && focusMinutes > 0) || task.repeat) && (
                <p className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-on-surface-2">
                  {task.estimateMinutes != null && (
                    <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> 预计 {task.estimateMinutes} 分钟</span>
                  )}
                  {focusMinutes != null && focusMinutes > 0 && (
                    <span className="inline-flex items-center gap-1.5"><Timer size={13} /> 累计专注 {focusMinutes} 分钟</span>
                  )}
                  {task.repeat && (
                    <span className="inline-flex items-center gap-1.5">
                      <Repeat size={13} /> 重复：{repeatLabel(task.repeat, { days: task.repeatDays, monthDay: task.repeatMonthDay })}
                      {task.repeatCount && task.repeatCount > 1 ? ` · 每周期 ${task.repeatCount} 次` : ''}
                    </span>
                  )}
                </p>
              )}

              <p className="col-span-2 md:col-span-4 text-[10.5px] text-on-surface-2/80">
                创建于 {new Date(task.createdAt).toLocaleString('zh-CN')} · 更新于 {new Date(task.updatedAt).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>

          {/* 固定操作栏：不用滚到底也能完成 / 置顶 / 删除；删除后 6 秒内可撤销 */}
          <div className="shrink-0 border-t border-outline px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
            <div className="flex items-center gap-1.5">
              {done ? (
                <Button variant="primary" className="flex-1 justify-center" onClick={() => void completeOrRestore()}>
                  恢复为未完成
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="flex-1 justify-center"
                  disabled={future}
                  title={future
                    ? (futureWhy === 'start' ? '未来任务，开始时间到了再完成' : '未来任务，到截止日后再完成')
                    : undefined}
                  onClick={() => void (habit ? checkIn() : completeOrRestore())}
                >
                  {future
                    ? '未来任务'
                    : habit
                      ? (habitTotal > 1 ? `打卡 +1（${habitCountDone}/${habitTotal}）` : '✓ 打卡')
                      : '✓ 完成并归档'}
                </Button>
              )}
              {!done && (
                <Button
                  aria-label={task.status === 'doing' ? '停止进行中' : '标记进行中'}
                  title={task.status === 'doing' ? '停止进行中' : '标记为进行中'}
                  onClick={() => patch({ status: task.status === 'doing' ? 'todo' : 'doing' })}
                  className="shrink-0 w-10 px-0 justify-center"
                >
                  <span className={cn('w-2.5 h-2.5 rounded-full', task.status === 'doing' ? 'bg-ok animate-ai-pulse' : 'bg-on-surface-2/40')} />
                </Button>
              )}
              <Button
                aria-label={task.pinned ? '取消置顶' : '置顶'}
                title={task.pinned ? '取消置顶' : '置顶到列表顶部'}
                onClick={() => { patch({ pinned: !task.pinned || undefined }); openDetail(null) }}
                className="shrink-0 w-10 px-0 justify-center"
              >
                {task.pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </Button>
              {!done && (
                <Button
                  aria-label="开始专注"
                  title="开始专注（番茄钟绑定本任务）"
                  onClick={() => {
                    // 写「待开始专注」指令：FocusTimer 挂载后消费它，弹出选时小框并自动开始
                    try { localStorage.setItem('ws-focus-start', JSON.stringify({ taskId: task.id, at: Date.now() })) } catch { /* ignore */ }
                    openDetail(null)
                    window.location.hash = `#/today?focus-task=${task.id}`
                  }}
                  className="shrink-0 w-10 px-0 justify-center"
                >
                  <Timer size={16} />
                </Button>
              )}
              <Button
                variant="danger"
                size="icon"
                aria-label="删除任务"
                title="删除任务（可撤销）"
                onClick={() => void remove()}
                className="shrink-0"
              >
                <Trash2 size={16} />
              </Button>
            </div>
            {future && !done && (
              <p className="text-[11px] text-p1 mt-1.5">
                {futureWhy === 'start'
                  ? '未来任务：开始时间还没到，暂不能勾完成。'
                  : '未来任务：截止日期还没到，暂不能勾完成。'}
              </p>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
