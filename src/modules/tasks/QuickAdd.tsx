import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Clock3, Flag, Hash, Plus, Repeat, Target, Timer } from 'lucide-react'
import { inferTier, parseQuickAdd, parseSummary } from '@/lib/nlp'
import { addTask } from '@/db/tasks'
import { fmtDue } from '@/lib/date'
import { repeatLabel } from '@/lib/repeat'
import { PRIORITY_VAR, type Tier } from '@/db/db'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'

interface Props {
  defaultTier?: Tier
  /** 今日页传 true：无日期时视为「今天」 */
  todayContext?: boolean
  placeholder?: string
}

/**
 * 自然语言快速添加（方案 2.1 增补项）：
 * 「明天14:00 交报告 P1 #工作」→ 自动解析日期/优先级/标签，实时预览，Enter 保存。
 */
export function QuickAdd({ defaultTier = 'anytime', todayContext = false, placeholder }: Props) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const toast = useUi(s => s.toast)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onFocus = () => inputRef.current?.focus()
    window.addEventListener('ws:focus-quickadd', onFocus)
    return () => window.removeEventListener('ws:focus-quickadd', onFocus)
  }, [])

  const parsed = parseQuickAdd(value)
  const chips = value.trim() ? parseSummary(parsed) : []
  const hasContent = value.trim().length > 0

  const submit = async () => {
    if (!hasContent || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const p = parsed
    let tier = inferTier(p, defaultTier)
    // 今日页语境：无日期的随手记也进「今日」
    if (todayContext && !p.due && !p.repeat && defaultTier === 'today') tier = 'today'
    try {
      await addTask({
        title: p.title,
        tier,
        priority: p.priority,
        // 没写截止就是无穷远：清单归属由 tier 表达，不硬塞一个「今天」当截止
        due: p.due,
        dueTime: p.dueTime,
        startAt: p.startAt,
        tags: p.tags,
        repeat: p.repeat,
        repeatDays: p.repeatDays,
        repeatMonthDay: p.repeatMonthDay,
        repeatCount: p.repeatCount,
        repeatTimes: p.repeatTimes,
        estimateMinutes: p.estimateMinutes,
      })
      setValue(current => current === value ? '' : current)
    } catch {
      toast('任务保存失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="card card-hover px-3.5 py-2.5 focus-within:border-primary/55 focus-within:ring-2 focus-within:ring-primary/15 transition-[border-color,box-shadow]"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid place-items-center size-7 rounded-full bg-primary-soft/85 text-primary shrink-0"
        >
          <Plus size={15} strokeWidth={2.3} />
        </span>
        <input
          ref={inputRef}
          id="quick-add-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 显式处理 Enter（比依赖表单隐式提交更可靠），跳过输入法合成态
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
              return
            }
            // ↓ 交棒给下方列表的键盘流
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              e.currentTarget.blur()
              window.dispatchEvent(new CustomEvent('ws:list-enter', { detail: { dir: 1 } }))
            }
          }}
          enterKeyHint="done"
          aria-label="快速添加任务"
          placeholder={placeholder ?? '添加任务…（明天14:00 交报告 P1 #工作）'}
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-on-surface-2/70"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!hasContent || saving}
          className="shrink-0"
        >
          {saving ? '添加中' : '添加'}
        </Button>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[11px] text-on-surface-2 mr-0.5">识别到</span>
          {parsed.due && <PreviewChip icon={CalendarDays} text={fmtDue(parsed.due, parsed.dueTime).text} />}
          {!parsed.due && parsed.dueTime && <PreviewChip icon={Clock3} text={parsed.dueTime} />}
          {parsed.repeat && <PreviewChip icon={Repeat} text={repeatLabel(parsed.repeat, { days: parsed.repeatDays, monthDay: parsed.repeatMonthDay })} />}
          {parsed.repeatCount != null && parsed.repeatCount > 1 && <PreviewChip icon={Target} text={`${parsed.repeatCount} 次`} />}
          {parsed.estimateMinutes != null && <PreviewChip icon={Timer} text={`约 ${parsed.estimateMinutes} 分钟`} />}
          {parsed.priority != null && (
            <PreviewChip
              icon={Flag}
              text={`P${parsed.priority}`}
              color={PRIORITY_VAR[parsed.priority]}
            />
          )}
          {parsed.tags.map((t) => (
            <PreviewChip key={t} icon={Hash} text={t} />
          ))}
        </div>
      )}
    </form>
  )
}

function PreviewChip({
  icon: Icon,
  text,
  color,
}: {
  icon: typeof CalendarDays
  text: string
  color?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px]',
        !color && 'bg-surface-3 text-on-surface-2',
      )}
      style={color ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined}
    >
      <Icon size={12} />
      {text}
    </span>
  )
}
