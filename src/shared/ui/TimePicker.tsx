import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Clock3 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { todayStr } from '@/lib/date'
import { DatePicker } from './DatePicker'

const PRESETS = ['09:00', '12:00', '14:00', '18:00', '20:00']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']
const FIELD = 'w-full h-10 px-2.5 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60'

interface TimePickerProps {
  value?: string
  onChange: (v?: string) => void
  placeholder?: string
  className?: string
  allowClear?: boolean
}

/**
 * 自绘时间面板：常用时间一键选，小时/分钟网格点选，完成才提交。
 * 面板就地展开而不是浮层，不会被弹窗滚动容器裁切，也不会和焦点圈打架。
 */
export function TimePicker({ value, onChange, placeholder = '选择时间', className, allowClear }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [hour, setHour] = useState('09')
  const [minute, setMinute] = useState('00')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    /**
     * 点面板外关闭 —— 但只有「轻点」才算。
     * 手机上弹出的面板常常要滚动页面才能看全，手指从面板外开始往上一划，
     * 旧实现（pointerdown 就直接关）会让人以为「这也不能碰、那也不能碰」；
     * 现在按下后只要有 8px 位移就当成滚动，不关闭。
     */
    let startX = 0
    let startY = 0
    let moved = false
    let tracking = false
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      startX = e.clientX
      startY = e.clientY
      moved = false
      tracking = true
    }
    const onMove = (e: PointerEvent) => {
      if (!tracking) return
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) moved = true
    }
    const onUp = () => {
      if (!tracking) return
      tracking = false
      if (!moved) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 面板展开后把它滚进可视区：手机上一屏放不下时，不用先摸黑往下拖
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 40)
    return () => window.clearTimeout(t)
  }, [open])

  const toggle = () => {
    if (!open) {
      const [h = '09', m = '00'] = (value || '09:00').split(':')
      setHour(h)
      setMinute(m)
    }
    setOpen((v) => !v)
  }

  const commit = (next?: string) => {
    onChange(next)
    setOpen(false)
  }

  // 旧数据可能带 07 分这种非 5 的倍数，补进分钟网格，别让当前值找不到落点
  const minutes = useMemo(() => {
    const list = [...MINUTES]
    if (minute && !list.includes(minute)) list.push(minute)
    return list.sort()
  }, [minute])

  const now = new Date()
  const nowValue = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div ref={rootRef} className={cn('flex flex-col gap-1.5', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={cn(FIELD, 'flex items-center gap-1.5 text-left cursor-pointer')}
      >
        <Clock3 size={14} className="text-on-surface-2 shrink-0" />
        <span className={cn('flex-1 truncate tabular-nums', !value && 'text-on-surface-2 font-normal')}>
          {value || placeholder}
        </span>
        <ChevronDown size={14} className={cn('text-on-surface-2 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          {/* 手机端轻遮罩：只压暗背景提示「这是浮层」，不拦截触摸。
              真正关闭靠「面板外轻点」（上面 pointer 逻辑：位移小于 8px 才算点击，
              滑动页面不会误退出）——滑到面板外面就把时间选择器关掉，是最烦人的那种行为 */}
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/25 pointer-events-none md:hidden"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="选择时间"
            // 手机端浮到底部（宽度够放 6 列分钟），桌面端仍然就地展开，不遮挡内容
            className={cn(
              'time-panel rounded-[10px] border border-outline bg-surface-2 p-2.5 overflow-y-auto overscroll-contain',
              'fixed left-1/2 -translate-x-1/2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 w-[min(380px,92vw)] max-h-[72dvh]',
              'md:static md:z-auto md:w-auto md:max-h-[min(62vh,440px)] md:translate-x-0 md:bottom-auto',
            )}
            style={{ animation: 'scale-in var(--dur-1) var(--ease-standard)' }}
          >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-on-surface-2">选择时间</span>
            <span className="text-[13px] font-semibold text-primary tabular-nums">{hour}:{minute}</span>
          </div>

          <div className="flex flex-wrap gap-1 mb-2.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => commit(p)}
                className={cn(
                  'h-7 px-2.5 rounded-full text-[11.5px] tabular-nums transition-colors cursor-pointer',
                  value === p ? 'bg-primary text-on-primary' : 'bg-surface-3/70 text-on-surface-2 hover:text-on-surface',
                )}
              >
                {p}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-on-surface-2 mb-1">小时</p>
          <div className="grid grid-cols-6 gap-1">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={hour === h}
                onClick={() => setHour(h)}
                className={cn(
                  'h-7 rounded-[7px] text-[11.5px] tabular-nums transition-colors cursor-pointer',
                  hour === h ? 'bg-primary text-on-primary font-medium' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
                )}
              >
                {h}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-on-surface-2 mb-1 mt-2">分钟</p>
          <div className="grid grid-cols-6 gap-1">
            {minutes.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={minute === m}
                onClick={() => setMinute(m)}
                className={cn(
                  'h-7 rounded-[7px] text-[11.5px] tabular-nums transition-colors cursor-pointer',
                  minute === m ? 'bg-primary text-on-primary font-medium' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
                )}
              >
                {m}
              </button>
            ))}
          </div>

          {/* 操作条钉在面板底部：面板可滚动时（手机上尤其需要），
              「清除 / 现在 / 完成」始终留在视线里，不用滑到最底才找得到 */}
          <div className="sticky bottom-0 -mx-2.5 -mb-2.5 mt-2.5 flex items-center gap-1.5 px-2.5 py-2 border-t border-outline/60 bg-surface-2 rounded-b-[10px]">
            {allowClear && (
              <button
                type="button"
                onClick={() => commit(undefined)}
                className="h-8 px-2.5 rounded-[8px] text-[12px] text-on-surface-2 hover:bg-surface-3 cursor-pointer whitespace-nowrap"
              >
                清除
              </button>
            )}
            <button
              type="button"
              onClick={() => commit(nowValue)}
              className="h-8 px-2.5 rounded-[8px] text-[12px] text-on-surface-2 hover:bg-surface-3 cursor-pointer whitespace-nowrap"
            >
              现在
            </button>
            <button
              type="button"
              onClick={() => commit(`${hour}:${minute}`)}
              className="ml-auto h-8 px-3 rounded-[8px] bg-primary text-on-primary text-[12px] font-medium inline-flex items-center gap-1 cursor-pointer active:scale-[0.97] transition-transform whitespace-nowrap"
            >
              <Check size={13} /> 完成
            </button>
          </div>
          </div>
        </>
      )}
    </div>
  )
}

interface DateTimeFieldProps {
  /** `YYYY-MM-DDTHH:mm`；日期或时间为空时也允许 */
  value: string
  onChange: (v: string) => void
  ariaLabel?: string
  className?: string
}

/** 日期 + 自绘时间：替代原生 datetime-local，时间面板全站统一 */
export function DateTimeField({ value, onChange, ariaLabel, className }: DateTimeFieldProps) {
  const date = value ? value.slice(0, 10) : ''
  const time = value.length >= 16 ? value.slice(11, 16) : ''

  const setDate = (d: string) => {
    if (!d) {
      onChange('')
      return
    }
    onChange(`${d}${time ? `T${time}` : ''}`)
  }

  const setTime = (t?: string) => {
    if (!t) {
      if (date) onChange(date)
      else onChange('')
      return
    }
    onChange(`${date || todayStr()}T${t}`)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <DatePicker
        ariaLabel={ariaLabel ? `${ariaLabel}日期` : '日期'}
        value={date}
        onChange={setDate}
      />
      <TimePicker value={time} onChange={setTime} placeholder="选择时间" allowClear />
    </div>
  )
}
