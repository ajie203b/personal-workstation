import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Flag, Hash, Repeat, Sparkles } from 'lucide-react'
import { inferTier, parseQuickAdd, parseSummary } from '@/lib/nlp'
import { addTask } from '@/db/tasks'
import { todayStr, fmtDue } from '@/lib/date'
import { PRIORITY_VAR, type RepeatKind, type Tier } from '@/db/db'
import { Sheet } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/lib/cn'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultTier?: Tier
  /** 今日页语境：无日期的单次任务进「今日」 */
  todayContext?: boolean
}

type Mode = 'single' | 'repeat'

const REPEAT_LABEL: Record<RepeatKind, string> = { daily: '每天', weekly: '每周', weekdays: '工作日' }

/**
 * 添加任务抽屉（方案迭代 v0.6）：
 * 点击加号 → 输入内容 → 自动检测单次/重复走不同流程；分辨不出时手动选择单次/重复与频率。
 */
export function AddTaskSheet({ open, onOpenChange, defaultTier = 'anytime', todayContext = false }: Props) {
  const [value, setValue] = useState('')
  const [modeOverride, setModeOverride] = useState<Mode | null>(null)
  const [freqOverride, setFreqOverride] = useState<RepeatKind>('daily')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setModeOverride(null)
      setFreqOverride('daily')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const parsed = useMemo(() => parseQuickAdd(value), [value])
  const detectedRepeat = parsed.repeat ?? null
  // 检测优先：文本里有每天/每周/工作日 → 重复流程；否则看用户手动选择
  const mode: Mode = detectedRepeat ? 'repeat' : (modeOverride ?? 'single')
  const effectiveRepeat: RepeatKind | undefined = detectedRepeat ?? (mode === 'repeat' ? freqOverride : undefined)
  const chips = value.trim() ? parseSummary(parsed) : []
  const hasContent = value.trim().length > 0

  const submit = () => {
    if (!hasContent) return
    const p = parseQuickAdd(value)
    let tier = inferTier(p, defaultTier)
    if (todayContext && !p.due && !p.repeat && defaultTier === 'today') tier = 'today'
    const due = p.due ?? (tier === 'today' && todayContext ? todayStr() : undefined)
    void addTask({
      title: p.title,
      tier,
      priority: p.priority,
      due,
      dueTime: p.dueTime,
      tags: p.tags,
      repeat: effectiveRepeat,
    })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="添加任务">
      <div className="flex flex-col gap-4">
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

        {/* 识别预览 */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 -mt-1">
            <span className="text-[11px] text-on-surface-2 mr-0.5">识别到</span>
            {parsed.due && <Chip icon={CalendarDays} text={fmtDue(parsed.due, parsed.dueTime).text} />}
            {parsed.repeat && <Chip icon={Repeat} text={REPEAT_LABEL[parsed.repeat]} />}
            {parsed.priority != null && <Chip icon={Flag} text={`P${parsed.priority}`} color={PRIORITY_VAR[parsed.priority]} />}
            {parsed.tags.map((t) => <Chip key={t} icon={Hash} text={t} />)}
          </div>
        )}

        {/* 流程分支：自动检测 + 手动选择兜底 */}
        <div className="card px-4 py-3.5 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px]">
            {detectedRepeat ? (
              <>
                <Sparkles size={14} className="text-primary" />
                <span>检测到 <b className="text-primary">重复任务</b>（{REPEAT_LABEL[detectedRepeat]}），完成后自动生成下一次</span>
              </>
            ) : (
              <>
                <span className="text-on-surface-2">这是什么类型的任务？</span>
              </>
            )}
          </div>
          <Segmented
            value={mode}
            onChange={(v) => setModeOverride(v as Mode)}
            className="w-full [&>button]:flex-1"
            options={[
              { value: 'single', label: '单次任务' },
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
              ]}
            />
          )}
          <p className="text-[11px] text-on-surface-2 leading-relaxed">
            {mode === 'repeat'
              ? '打卡任务：完成后会自动创建下一天（周期）的同款任务，连续记录在日志里。'
              : '单次任务：完成后进入日志归档。'}
          </p>
        </div>

        <Button variant="primary" disabled={!hasContent} onClick={submit} className="w-full justify-center">
          {mode === 'repeat' ? '添加打卡任务' : '添加任务'}
        </Button>
      </div>
    </Sheet>
  )
}

function Chip({ icon: Icon, text, color }: { icon: typeof CalendarDays; text: string; color?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px]', !color && 'bg-surface-3 text-on-surface-2')}
      style={color ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, color } : undefined}
    >
      <Icon size={12} />
      {text}
    </span>
  )
}
