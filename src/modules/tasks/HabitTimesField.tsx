import { X } from 'lucide-react'
import { TimePicker } from '@/shared/ui/TimePicker'

/**
 * 打卡时间点编辑器（v3.1）：一个打卡任务可以有一到多个时间点。
 * 「每天 8 点、21 点各喝一次水」→ ['08:00','21:00']，
 * 列表里显示成一串小时间，提醒按各时间点分别排。
 *
 * 用 TimePicker 逐次追加而不是逗号分隔输入：手机上输「:」很别扭，
 * 而且已有时间点需要能单独删掉。
 */
export function HabitTimesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const add = (t?: string) => {
    if (!t || value.includes(t)) return
    onChange([...value, t].sort())
  }
  const remove = (t: string) => onChange(value.filter((x) => x !== t))

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-surface-3 text-[12px] tabular-nums"
            >
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label={`移除 ${t}`}
                title="移除这个时间点"
                className="grid place-items-center w-5 h-5 rounded-full text-on-surface-2 hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <TimePicker value="" onChange={add} placeholder={value.length ? '再加一个时间点' : '选择打卡时间（可多个）'} />
    </div>
  )
}
