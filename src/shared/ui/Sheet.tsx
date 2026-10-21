import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

const NARROW_Q = '(max-width: 767px)'

/**
 * 侧滑详情面板：桌面/平板横屏=右侧滑入（440px），手机=底部抽屉（85dvh）。
 * Radix Dialog 保证焦点圈定、Esc 关闭等无障碍行为。
 *
 * 跟手侧滑关闭（动效方案 5.D，全端生效）：
 * - 手机：内容已滚到顶且向下拖时才接管，否则让给列表滚动；
 * - 桌面：右侧面板横向向右拖关闭；
 * - 松手按「位移阈值 或 速度 > 0.5px/ms」判定关闭，否则回弹；
 * - 判定成立才关，所以内部按钮的 click 仍会正常触发（不会误吞点击）。
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_Q).matches)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const moved = useRef(false)
  const start = useRef({ x: 0, y: 0, t: 0 })
  const active = useRef(false)

  // 形态感知：手机=纵向抽屉，桌面=右侧面板
  useEffect(() => {
    const mq = window.matchMedia(NARROW_Q)
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // 不跟手时保持 0，避免卸载重挂后残留位移
  useEffect(() => {
    if (!open) {
      active.current = false
      moved.current = false
      setDragging(false)
      setDrag(0)
    }
  }, [open])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, input, textarea, select, [contenteditable="true"]')) return
      if (narrow) {
        // 手机：内容滚到顶才接管下拉
        const body = bodyRef.current
        if (!body || body.scrollTop > 1) return
      }
      active.current = true
      moved.current = false
      start.current = { x: e.clientX, y: e.clientY, t: performance.now() }
    },
    [narrow],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!active.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      if (narrow) {
        // 只有真的向下拖够距离才进入跟手态，避免微抖吞掉点击
        if (dy < 6) return
        if (Math.abs(dx) > Math.abs(dy)) return
        if (!moved.current) e.currentTarget.getAnimations().forEach((a) => a.cancel())
        moved.current = true
        setDragging(true)
        setDrag(dy * 0.86)
      } else {
        // 桌面：只跟向右拖关闭
        if (dx < 6) return
        if (Math.abs(dy) > Math.abs(dx)) return
        if (!moved.current) e.currentTarget.getAnimations().forEach((a) => a.cancel())
        moved.current = true
        setDragging(true)
        setDrag(dx * 0.86)
      }
    },
    [narrow],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!active.current) return
      active.current = false
      setDragging(false)
      if (!moved.current) {
        setDrag(0)
        return
      }
      const delta = narrow ? e.clientY - start.current.y : e.clientX - start.current.x
      const velocity = delta / Math.max(1, performance.now() - start.current.t)
      const limit = narrow ? 90 : 110
      if (delta > limit || velocity > 0.5) {
        haptic('light')
        setDrag(0)
        onOpenChange(false)
      } else {
        setDrag(0)
      }
    },
    [narrow, onOpenChange],
  )

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-40 bg-black/30 overlay-fade"
          style={drag > 0 ? { opacity: Math.max(0.3, 1 - drag / 460) } : undefined}
        />
        <RadixDialog.Content
          data-app-modal="sheet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(
            'fixed z-50 bg-surface border-outline flex flex-col',
            'max-md:inset-x-0 max-md:bottom-0 max-md:h-[85dvh] max-md:rounded-t-[20px] max-md:border-t max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
            'md:top-0 md:right-0 md:bottom-0 md:w-[min(440px,92vw)] md:border-l',
          )}
          style={{
            transform: drag ? (narrow ? `translateY(${drag}px)` : `translateX(${drag}px)`) : undefined,
            transition: dragging ? 'none' : 'transform var(--dur-2) var(--ease-standard)',
            animation: `${narrow ? 'sheet-rise' : 'slide-left'} var(--dur-3) var(--ease-soft-spring)`,
          }}
        >
          {/* 抽屉把手（手机）：明示可往下拽 */}
          <div className="md:hidden flex justify-center pt-2.5 shrink-0" aria-hidden>
            <span className="w-10 h-1 rounded-full bg-outline" />
          </div>
          <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-outline">
            <RadixDialog.Title className="text-[16px] font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="关闭"
              className="grid place-items-center w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <div ref={bodyRef} className="flex-1 overflow-y-auto p-5">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  widthClass = 'w-[min(400px,92vw)]',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  /** 默认 400px；宽短弹窗传 w-[min(620px,92vw)] */
  widthClass?: string
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30 overlay-fade" />
        <RadixDialog.Content
          data-app-modal="dialog"
          className={cn(
            'dialog-panel pop fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-5',
            // 矮视口/宽弹窗（添加任务 620px）时内容会顶出屏幕且无法滚动
            'flex flex-col max-h-[min(86dvh,720px)] overflow-y-auto',
            widthClass,
          )}
          style={{ animation: 'scale-in var(--dur-2) var(--ease-spring)' }}
        >
          <RadixDialog.Title className="text-[17px] font-semibold">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1.5 text-[13px] text-on-surface-2 leading-relaxed">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
