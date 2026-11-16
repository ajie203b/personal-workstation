import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useUi, type ToastItem } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { useFocusActive } from '@/shared/FocusMiniBar'

/** 轻提示：底部居中（手机）/ 右下角（桌面），支持「撤销」与上滑收走 */
export function ToastHost() {
  const toast = useUi((s) => s.toasts[0])
  const dismissToast = useUi((s) => s.dismissToast)
  const focusActive = useFocusActive()
  if (!toast) return null
  return (
    <div className={cn('fixed z-[60] inset-x-0 px-4 flex justify-center lg:justify-end lg:right-5 lg:left-auto pointer-events-none lg:max-w-sm lg:bottom-6',
      focusActive ? 'bottom-[calc(8.25rem+3.5rem+12px+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.25rem+3.5rem+12px+env(safe-area-inset-bottom))]')}>
      <ToastCard key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
    </div>
  )
}

function ToastCard({ toast: t, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [swiped, setSwiped] = useState(false)
  const drag = useRef<{ y: number; at: number } | null>(null)

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // 按在「撤销/关闭」按钮上时不接管指针：捕获中的鼠标 click 会被重定向到卡片本身，
    // 桌面端点撤销就没反应了（触屏的 click 仍落在原目标，所以安卓一直正常）
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { y: e.clientY, at: performance.now() }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const delta = e.clientY - drag.current.y
    // 只跟手向上，向下拉有「到头了」的抵抗感
    if (delta < 0) setDy(delta)
    else setDy(delta * 0.18)
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const delta = e.clientY - drag.current.y
    const velocity = delta / Math.max(1, performance.now() - drag.current.at)
    drag.current = null
    setDragging(false)
    if (delta < -36 || velocity < -0.5) {
      haptic('light')
      setSwiped(true)
      onDismiss()
      return
    }
    setDy(0)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className={cn(
        'toast-card pointer-events-auto relative overflow-hidden flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-[16px] shadow-lg max-w-full md:max-w-sm',
        t.leaving && (swiped ? 'toast-leave-up' : 'toast-leave'),
      )}
      style={{
        background: 'var(--surface)',
        color: 'var(--on-surface)',
        border: '1px solid var(--outline)',
        boxShadow: 'var(--shadow-pop)',
        transform: t.leaving ? undefined : dy ? `translateY(${dy}px)` : undefined,
        opacity: dy ? Math.max(0.35, 1 + dy / 160) : undefined,
        transition: dragging ? 'none' : 'transform 260ms var(--ease-soft-spring), opacity 200ms var(--ease-standard)',
        touchAction: 'none',
      }}
    >
      <span className="text-[13px] min-w-0 line-clamp-2 break-all">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="text-[13px] font-semibold px-2 py-1 rounded-lg hover:bg-primary-soft shrink-0 transition-colors"
          style={{ color: 'var(--primary)', fontWeight: 600 }}
          onClick={() => {
            if (t.leaving) return
            onDismiss()
            t.action!.run()
          }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="关闭提示"
        className="grid size-8 shrink-0 place-items-center opacity-55 hover:opacity-100 rounded-lg transition-opacity"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
      {/* 倒计时线：和自动消失时间同源，看得见还剩多久 */}
      {t.action && (
        <span
          aria-hidden
          className="toast-countdown"
          style={{ animationDuration: `${t.duration}ms` }}
        />
      )}
    </div>
  )
}
