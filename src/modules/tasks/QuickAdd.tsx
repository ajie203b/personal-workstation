import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Flag, Hash, Repeat } from 'lucide-react'
import { inferTier, parseQuickAdd, parseSummary } from '@/lib/nlp'
import { addTask } from '@/db/tasks'
import { todayStr, fmtDue } from '@/lib/date'
import { PRIORITY_VAR, type Tier } from '@/db/db'
import { cn } from '@/lib/cn'

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onFocus = () => inputRef.current?.focus()
    window.addEventListener('ws:focus-quickadd', onFocus)
    return () => window.removeEventListener('ws:focus-quickadd', onFocus)
  }, [])

  const parsed = parseQuickAdd(value)
  const chips = value.trim() ? parseSummary(parsed) : []
  const hasContent = value.trim().length > 0

  const submit = () => {
    if (!hasContent) return
    const p = parseQuickAdd(value)
    let tier = inferTier(p, defaultTier)
    // 今日页语境：无日期的随手记也进「今日」
    if (todayContext && !p.due && !p.repeat && defaultTier === 'today') tier = 'today'
    void addTask({
      title: p.title,
      tier,
      priority: p.priority,
      due: p.due ?? (tier === 'today' && todayContext && !p.repeat ? todayStr() : undefined),
      dueTime: p.dueTime,
      tags: p.tags,
      repeat: p.repeat,
    })
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="card card-hover px-4 py-3 focus-within:border-primary/50"
    >
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 显式处理 Enter（比依赖表单隐式提交更可靠），跳过输入法合成态
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          enterKeyHint="done"
          aria-label="快速添加任务"
          placeholder={placeholder ?? '添加任务…（明天14:00 交报告 P1 #工作）'}
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-on-surface-2/70"
        />
        <kbd className="kbd hidden md:inline-block">↵</kbd>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[11px] text-on-surface-2 mr-0.5">识别到</span>
          {parsed.due && <PreviewChip icon={CalendarDays} text={dueChipText(parsed.due, parsed.dueTime)} />}
          {parsed.repeat && <PreviewChip icon={Repeat} text={{ daily: '每天', weekly: '每周', weekdays: '工作日' }[parsed.repeat]} />}
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

function dueChipText(due: string, time?: string) {
  return fmtDue(due, time).text
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
        'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px]',
        !color && 'bg-surface-3 text-on-surface-2',
      )}
      style={color ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined}
    >
      <Icon size={12} />
      {text}
    </span>
  )
}
