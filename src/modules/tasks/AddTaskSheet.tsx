import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Clock3, Flag, Hash, ListChecks, Repeat, Sparkles, Target, Timer, X } from 'lucide-react'
import { inferTier, parseQuickAdd, parseSummary } from '@/lib/nlp'
import { repeatLabel } from '@/lib/repeat'
import { addTask } from '@/db/tasks'
import { fmtDue, fmtTime, toDateStr } from '@/lib/date'
import { uid } from '@/lib/id'
import { PRIORITY_VAR, TIERS, TIER_LABEL, type Priority, type RepeatKind, type Tier } from '@/db/db'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { DateTimeField } from '@/shared/ui/TimePicker'
import { HabitTimesField } from './HabitTimesField'
import { TASK_TEMPLATES, type TaskTemplate } from './taskTemplates'
import { cn } from '@/lib/cn'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultTier?: Tier
  /** 今日页语境：无日期的单次任务进「今日」 */
  todayContext?: boolean
}

type Mode = 'single' | 'repeat'

/**
 * 添加任务抽屉（方案迭代 v0.6 + Phase 4）：
 * 支持 NLP 自然语言解析、移动端优先级/清单可视化快选，以及内置子任务模板一键填充。
 */
export function AddTaskSheet({ open, onOpenChange, defaultTier = 'anytime', todayContext = false }: Props) {
  const [value, setValue] = useState('')
  const [modeOverride, setModeOverride] = useState<Mode | null>(null)
  const [freqOverride, setFreqOverride] = useState<RepeatKind>('daily')
  const [priorityOverride, setPriorityOverride] = useState<Priority | null>(null)
  const [tierOverride, setTierOverride] = useState<Tier | null>(null)
  const [extraTags, setExtraTags] = useState<string[]>([])
  const [templateSubtasks, setTemplateSubtasks] = useState<string[]>([])
  // null = 尚未手动操作，跟随解析；'' = 用户明确清空，不再回填。
  const [startInput, setStartInput] = useState<string | null>(null)
  const [dueInput, setDueInput] = useState<string | null>(null)
  const [habitTimes, setHabitTimes] = useState<string[] | null>(null)
  const [habitCount, setHabitCount] = useState('')
  const [timeExpansion, setTimeExpansion] = useState<{ key: string; open: boolean } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setModeOverride(null)
      setFreqOverride('daily')
      setPriorityOverride(null)
      setTierOverride(null)
      setExtraTags([])
      setTemplateSubtasks([])
      setStartInput(null)
      setDueInput(null)
      setHabitTimes(null)
      setHabitCount('')
      setTimeExpansion(null)
    }
  }, [open])

  const parsed = useMemo(() => parseQuickAdd(value), [value])
  const effectiveStart = startInput ?? (parsed.startAt == null ? '' : `${toDateStr(new Date(parsed.startAt))}T${fmtTime(parsed.startAt)}`)
  const detectedRepeat = parsed.repeat ?? null
  // 检测优先：文本里有每天/每周/工作日 → 重复流程；否则看用户手动选择
  const mode: Mode = modeOverride ?? (detectedRepeat ? 'repeat' : 'single')
  const effectiveRepeat: RepeatKind | undefined = mode === 'repeat' ? (detectedRepeat ?? freqOverride) : undefined
  const detectedDueTime = mode === 'repeat' && habitTimes !== null ? habitTimes[0] : parsed.dueTime
  const effectiveDue = dueInput ?? (parsed.due ? `${parsed.due}${detectedDueTime ? `T${detectedDueTime}` : ''}` : '')
  // 文本里带细化的周期（每周一三五 / 每月15号）时一并带上；用户手动改过频率就不带
  const keepsDetectedDays = mode === 'repeat' && effectiveRepeat === detectedRepeat
  const chips = value.trim() ? parseSummary(parsed) : []
  const hasContent = value.trim().length > 0
  const detectedTimes = parsed.repeatTimes?.length ? parsed.repeatTimes : parsed.dueTime ? [parsed.dueTime] : []
  const effectiveTimes = habitTimes ?? detectedTimes
  const scheduleKey = [parsed.startAt, parsed.due, parsed.dueTime, parsed.repeat, parsed.repeatDays?.join(','), parsed.repeatTimes?.join(',')].filter(v => v != null).join('|')
  const timeOpen = timeExpansion?.key === scheduleKey ? timeExpansion.open : Boolean(scheduleKey || effectiveStart || effectiveDue)
  const effectivePriority: Priority | undefined = priorityOverride ?? parsed.priority
  const mergedTags = useMemo(() => Array.from(new Set([...parsed.tags, ...extraTags])), [parsed.tags, extraTags])

  const applyTemplate = (tpl: TaskTemplate) => {
    setValue(tpl.title)
    setPriorityOverride(tpl.priority)
    if (tpl.tier) setTierOverride(tpl.tier)
    setExtraTags(tpl.tags)
    setTemplateSubtasks(tpl.subtasks)
  }

  const { state: saveState, run: runSave } = useAsyncButton({ successHoldMs: 520 })

  const submit = async () => {
    if (!hasContent || saveState !== 'idle') return
    const p = parsed
    // 手动选的时间优先于文本解析
    // 截止留空 = 无穷远（需求）：以前今日页会补一个「今天」，结果一新建就背着逾期压力
    const due = effectiveDue ? effectiveDue.slice(0, 10) : undefined
    let tier = tierOverride ?? inferTier({ ...p, repeat: effectiveRepeat, due }, defaultTier)
    if (!tierOverride && todayContext && !due && !effectiveRepeat && defaultTier === 'today') tier = 'today'
    // 打卡时间点：手动加的优先，其次用标题里解析到的（可能多个）
    const times = mode === 'repeat' ? effectiveTimes : []
    const dueTime = dueInput !== null
      ? effectiveDue.slice(11, 16) || undefined
      : times[0] ?? (effectiveDue.slice(11, 16) || undefined)
    // 打卡次数：手填优先，其次用标题里识别到的（「喝水8次」→ 8）
    const countRaw = habitCount.trim() ? Number(habitCount) : p.repeatCount
    const repeatCount = mode === 'repeat' && Number.isFinite(countRaw) && (countRaw ?? 0) > 1
      ? Math.min(99, Math.round(countRaw as number))
      : undefined
    const startAt = effectiveStart ? new Date(effectiveStart.length === 10 ? `${effectiveStart}T00:00` : effectiveStart).getTime() : undefined
    const subtasks = templateSubtasks.length
      ? templateSubtasks.map((title) => ({ id: uid(), title, done: false }))
      : undefined
    let saved = false
    try {
      await runSave(async () => {
        await addTask({
          title: p.title,
          tier,
          priority: effectivePriority,
          due,
          dueTime,
          startAt,
          tags: mergedTags,
          repeat: effectiveRepeat,
          repeatDays: keepsDetectedDays ? parsed.repeatDays : undefined,
          repeatMonthDay: keepsDetectedDays ? parsed.repeatMonthDay : undefined,
          repeatCount,
          repeatTimes: times.length > 1 ? times : undefined,
          estimateMinutes: p.estimateMinutes,
          subtasks,
        })
        saved = true
      })
    } catch {
      /* 失败态由按钮呈现，这里不制造未处理的 Promise 拒绝 */
      return
    }
    // 成功打勾亮完再收场；中途被关掉就别抢用户的操作
    if (saved && open) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="添加任务" widthClass="w-[min(620px,92vw)]" mobileSheet initialFocus={inputRef}>
      <div className="flex flex-col gap-3">
        {/* 预设模板快捷芯片 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mb-1">
          <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-2 shrink-0">
            <Sparkles size={11} /> 模板
          </span>
          {TASK_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="shrink-0 h-7 px-2.5 rounded-full border border-outline bg-surface-2 text-[11.5px] text-on-surface-2 hover:text-primary hover:border-primary/40 hover:bg-primary-soft/50 transition-colors cursor-pointer"
            >
              {tpl.name}
            </button>
          ))}
        </div>

        {/* 输入区 */}
        <div className="card px-3.5 py-3 focus-within:border-primary/50 transition-colors">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={3}
            placeholder={'描述任务…（明天14:00 交报告 P1 #工作）\n写「每天」等字样会自动识别为打卡任务'}
            className="w-full bg-transparent outline-none resize-none text-[15px] leading-relaxed placeholder:text-on-surface-2/70"
          />
        </div>

        {/* 优先级与清单可视化快选（移动端无需背 NLP 语法） */}
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <div className="inline-flex items-center gap-1" role="group" aria-label="快捷优先级">
            {([0, 1, 2, 3] as const).map((p) => {
              const active = effectivePriority === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriorityOverride((prev) => (prev === p ? null : p))}
                  aria-pressed={active}
                  className={cn(
                    'h-7 px-2 rounded-[8px] border text-[11.5px] font-medium transition-colors cursor-pointer',
                    active ? 'border-transparent text-white' : 'border-outline bg-surface-2 text-on-surface-2 hover:text-on-surface',
                  )}
                  style={active ? { background: PRIORITY_VAR[p] } : undefined}
                >
                  P{p}
                </button>
              )
            })}
          </div>
          <span className="w-px h-4 bg-outline/80" aria-hidden />
          <div className="inline-flex items-center gap-1 flex-wrap" role="group" aria-label="快捷清单">
            {TIERS.map((t) => {
              const active = tierOverride === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTierOverride((prev) => (prev === t ? null : t))}
                  aria-pressed={active}
                  className={cn(
                    'h-7 px-2 rounded-[8px] border text-[11.5px] font-medium transition-colors cursor-pointer',
                    active ? 'border-primary/50 bg-primary-soft text-primary' : 'border-outline bg-surface-2 text-on-surface-2 hover:text-on-surface',
                  )}
                >
                  {TIER_LABEL[t]}
                </button>
              )
            })}
          </div>
        </div>

        {templateSubtasks.length > 0 && (
          <div className="rounded-[12px] border border-outline bg-surface-2/70 px-3 py-2 flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11.5px] text-on-surface-2">
              <span className="inline-flex items-center gap-1 font-medium text-on-surface">
                <ListChecks size={13} className="text-primary" /> 附带 {templateSubtasks.length} 条子任务
              </span>
              <button
                type="button"
                onClick={() => setTemplateSubtasks([])}
                className="inline-flex items-center gap-0.5 text-on-surface-2 hover:text-danger cursor-pointer"
              >
                <X size={12} /> 移除
              </button>
            </div>
            <ul className="text-[12px] text-on-surface-2 space-y-0.5 pl-4 list-disc">
              {templateSubtasks.map((s, idx) => <li key={idx}>{s}</li>)}
            </ul>
          </div>
        )}

        {/* 识别预览：日期/时间/次数/时长/重复/优先级/标签，猜出来的会带（猜） */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 -mt-1">
            <span className="text-[11px] text-on-surface-2 mr-0.5">识别到</span>
            {parsed.due && <Chip icon={CalendarDays} text={fmtDue(parsed.due, parsed.dueTime).text} />}
            {!parsed.due && parsed.dueTime && <Chip icon={Clock3} text={parsed.dueTime} />}
            {parsed.repeat && <Chip icon={Repeat} text={repeatLabel(parsed.repeat, { days: parsed.repeatDays, monthDay: parsed.repeatMonthDay })} />}
            {parsed.repeatCount != null && parsed.repeatCount > 1 && <Chip icon={Target} text={`${parsed.repeatCount} 次`} />}
            {parsed.estimateMinutes != null && <Chip icon={Timer} text={`约 ${parsed.estimateMinutes} 分钟`} />}
            {parsed.priority != null && <Chip icon={Flag} text={`P${parsed.priority}`} color={PRIORITY_VAR[parsed.priority]} />}
            {parsed.tags.map((t) => <Chip key={t} icon={Hash} text={t} />)}
          </div>
        )}

        {/* 解析结果直接展示；用户手动修改后，以用户的输入为准 */}
        <div className="card px-4 py-3.5 flex flex-col gap-2.5">
          <button type="button" aria-label="时间设置" aria-expanded={timeOpen} aria-controls="add-task-time-fields"
            onClick={() => setTimeExpansion({ key: scheduleKey, open: !timeOpen })}
            className="flex items-center gap-2 text-[13px] text-left cursor-pointer">
            <Clock3 size={14} className="text-on-surface-2" />
            <span>时间</span>
            <span className="flex-1 text-[11px] text-on-surface-2">{scheduleKey ? '已自动识别，可展开核对或修改' : effectiveStart || effectiveDue ? '已设置' : '未设置 · 需要时展开'}</span>
            <ChevronDown size={14} className={cn('shrink-0 transition-transform', timeOpen && 'rotate-180')} />
          </button>
          {timeOpen && <div id="add-task-time-fields" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <span className="block text-[12px] font-medium text-on-surface-2 mb-1">开始时间</span>
              <DateTimeField ariaLabel="开始时间" value={effectiveStart} onChange={setStartInput} />
            </div>
            <div>
              <span className="block text-[12px] font-medium text-on-surface-2 mb-1">截止时间</span>
              <DateTimeField ariaLabel="截止时间" value={effectiveDue} onChange={setDueInput} />
            </div>
          </div>}
        </div>

        {/* 流程分支：自动检测 + 手动选择兜底 */}
        <div className="card px-4 py-3.5 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px]">
            {detectedRepeat ? (
              <>
                <Repeat size={14} className="text-primary" />
                <span>检测到 <b className="text-primary">重复任务</b>（{repeatLabel(detectedRepeat, { days: parsed.repeatDays, monthDay: parsed.repeatMonthDay })}），完成后自动生成下一次</span>
              </>
            ) : (
              <>
                <span className="text-on-surface-2">这是什么类型的任务？</span>
              </>
            )}
          </div>
          <Segmented
            value={mode}
            onChange={(v) => { setModeOverride(v as Mode); if (v === 'single') setFreqOverride('daily') }}
            className="w-full [&>button]:flex-1"
            options={[
              { value: 'single', label: detectedRepeat ? '单次（忽略检测）' : '单次任务' },
              { value: 'repeat', label: '重复 / 打卡' },
            ]}
          />
          {mode === 'repeat' && !detectedRepeat && (
            <Segmented
              size="sm"
              value={freqOverride}
              onChange={(v) => setFreqOverride(v as RepeatKind)}
              options={[
                { value: 'daily', label: '每天' },
                { value: 'weekly', label: '每周' },
                { value: 'weekdays', label: '工作日' },
                { value: 'monthly', label: '每月' },
              ]}
            />
          )}
          {mode === 'repeat' && (
            <div className="grid grid-cols-[1fr_96px] items-start gap-2.5">
              <div>
                <span className="block text-[12px] font-medium text-on-surface-2 mb-1">打卡时间点（可多个）</span>
                <HabitTimesField value={effectiveTimes} onChange={setHabitTimes} />
              </div>
              <label className="block">
                <span className="block text-[12px] font-medium text-on-surface-2 mb-1">次数</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  value={habitCount}
                  onChange={(e) => setHabitCount(e.target.value)}
                  placeholder={parsed.repeatCount ? String(parsed.repeatCount) : '1'}
                  className="w-full h-10 px-2.5 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60 tabular-nums"
                />
                <span className="block text-[10.5px] text-on-surface-2 mt-1 leading-tight">一个周期打几次</span>
              </label>
            </div>
          )}
          <p className="text-[11px] text-on-surface-2 leading-relaxed">
            {mode === 'repeat'
              ? '打卡任务：每点一次勾记一次，打满「次数」才归档并生成下一周期；时间点可填多个（如早 8 点、晚 9 点）。'
              : '单次任务：完成后进入日志归档。'}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!hasContent} state={saveState} onClick={() => void submit()}>
            {mode === 'repeat' ? '添加打卡任务' : '添加任务'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function Chip({ icon: Icon, text, color }: { icon: typeof CalendarDays; text: string; color?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px]', !color && 'bg-surface-3 text-on-surface-2')}
      style={color ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined}
    >
      <Icon size={12} />
      {text}
    </span>
  )
}
