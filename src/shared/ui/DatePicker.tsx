import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { addDaysStr, fmtDate, parseDateStr, todayStr, toDateStr } from '@/lib/date'
import { cn } from '@/lib/cn'

const CELL = 'h-9 rounded-[8px] text-[12px] tabular-nums cursor-pointer hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-primary'

/** 与时间面板一致的日历，年/月可直接跳选，不调用 Android 原生日期弹窗。 */
export function DatePicker({ value = '', onChange, ariaLabel = '日期' }: {
  value?: string; onChange: (date: string) => void; ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => parseDateStr(value || todayStr()))
  const [mode, setMode] = useState<'day' | 'month' | 'year'>('day')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const year = view.getFullYear()
  const month = view.getMonth()
  const today = todayStr()

  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  const commit = (date: string) => { onChange(date); close() }

  useEffect(() => {
    if (!open) return
    let start: { x: number; y: number } | undefined
    let moved = false
    const down = (e: PointerEvent) => {
      start = root.current?.contains(e.target as Node) ? undefined : { x: e.clientX, y: e.clientY }
      moved = false
    }
    const move = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) moved = true
    }
    const up = () => { if (start && !moved) setOpen(false); start = undefined }
    const cancel = () => { start = undefined }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', key, true)
    root.current?.querySelector<HTMLElement>('[data-date-panel] button')?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  const first = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - (first.getDay() + 6) % 7)
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })
  const shift = (dir: number) => setView(new Date(year + (mode === 'year' ? dir * 12 : mode === 'month' ? dir : 0), month + (mode === 'day' ? dir : 0), 1))

  return (
    <div ref={root} className="flex flex-col gap-1.5">
      <button ref={trigger} type="button" aria-label={ariaLabel} value={value} aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
        onClick={() => { if (!open) { setView(parseDateStr(value || today)); setMode('day') }; setOpen(v => !v) }}
        className="w-full h-10 px-2.5 rounded-[10px] bg-surface-2 border border-outline text-[13px] flex items-center gap-1.5 text-left cursor-pointer focus-visible:outline-primary">
        <CalendarDays size={14} className="text-on-surface-2 shrink-0" />
        <span className={cn('flex-1 truncate', !value && 'text-on-surface-2')}>{value ? fmtDate(value) : '选择日期'}</span>
        <ChevronDown size={14} className={cn('text-on-surface-2 shrink-0', open && 'rotate-180')} />
      </button>
      {open && <>
        <div aria-hidden className="fixed inset-0 z-40 bg-black/25 pointer-events-none md:hidden" />
        <div id={panelId} role="dialog" aria-label={`选择${ariaLabel}`} data-date-panel
          className="time-panel rounded-[10px] border border-outline bg-surface-2 p-2.5 overflow-y-auto overscroll-contain fixed left-1/2 -translate-x-1/2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 w-[min(380px,92vw)] max-h-[72dvh] md:static md:z-auto md:w-auto md:max-h-[min(62vh,440px)] md:translate-x-0 md:bottom-auto">
          <div className="flex items-center gap-1 mb-2">
            <button type="button" aria-label={mode === 'day' ? '上个月' : mode === 'month' ? '上一年' : '前十二年'} className={cn(CELL, 'w-9')} onClick={() => shift(-1)}><ChevronLeft size={16} className="mx-auto" /></button>
            <div className="flex-1 flex justify-center gap-1">
              <button type="button" className={cn(CELL, 'px-2 font-semibold')} onClick={() => setMode(mode === 'year' ? 'day' : 'year')}>{year}年</button>
              <button type="button" className={cn(CELL, 'px-2 font-semibold')} onClick={() => setMode(mode === 'month' ? 'day' : 'month')}>{month + 1}月</button>
            </div>
            <button type="button" aria-label={mode === 'day' ? '下个月' : mode === 'month' ? '下一年' : '后十二年'} className={cn(CELL, 'w-9')} onClick={() => shift(1)}><ChevronRight size={16} className="mx-auto" /></button>
            <button type="button" aria-label="关闭日期选择" className={cn(CELL, 'w-8')} onClick={close}><X size={14} className="mx-auto" /></button>
          </div>
          {mode === 'day' ? <>
            <div className="grid grid-cols-7 text-center text-[11px] text-on-surface-2 mb-1" aria-hidden>{['一', '二', '三', '四', '五', '六', '日'].map(d => <span key={d}>{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map(day => {
                const date = toDateStr(day)
                return <button key={date} type="button" aria-label={fmtDate(day)} aria-pressed={date === value} aria-current={date === today ? 'date' : undefined}
                  onClick={() => commit(date)} className={cn(CELL, date === value ? 'bg-primary text-on-primary font-semibold hover:bg-primary' : day.getMonth() !== month ? 'text-on-surface-2/50' : 'text-on-surface', date === today && date !== value && 'ring-1 ring-inset ring-primary/50 text-primary')}>
                  {day.getDate()}
                </button>
              })}
            </div>
          </> : <div className="grid grid-cols-3 gap-1">
            {(mode === 'month' ? Array.from({ length: 12 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => year - 5 + i)).map(n =>
              <button key={n} type="button" className={cn(CELL, 'h-11', (mode === 'month' ? n === month : n === year) && 'bg-primary text-on-primary hover:bg-primary')}
                onClick={() => { setView(new Date(mode === 'year' ? n : year, mode === 'month' ? n : month, 1)); setMode(mode === 'year' ? 'month' : 'day') }}>
                {mode === 'month' ? `${n + 1}月` : `${n}年`}
              </button>)}
          </div>}
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-outline/60">
            <button type="button" className={cn(CELL, 'px-2 text-on-surface-2')} onClick={() => commit('')}>清除</button>
            <button type="button" className={cn(CELL, 'px-2 text-primary')} onClick={() => commit(today)}>今天</button>
            <button type="button" className={cn(CELL, 'px-2 text-primary')} onClick={() => commit(addDaysStr(1))}>明天</button>
            <button type="button" className={cn(CELL, 'ml-auto px-2 text-primary')} onClick={() => commit(addDaysStr(7))}>一周后</button>
          </div>
        </div>
      </>}
    </div>
  )
}
