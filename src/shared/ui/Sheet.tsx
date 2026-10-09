import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

/** 只在手机形态（<md）下跟手 */
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches

/**
 * 侧滑详情面板：桌面/平板横屏=右侧滑入（440px），手机=底部抽屉（85dvh）。
 * Radix Dialog 保证焦点圈定、Esc 关闭等无障碍行为。
 *
 * 手机抽屉跟手下拉关闭（动效方案 5.D）：
 * - 内容已滚到顶且向下拖时才接管，否则让给列表滚动；
 * - 松手按「位移 > 90px 或 速度 > 0.5px/ms」判定关闭，否则回弹；
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
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const moved = useRef(false)
  const start = useRef({ y: 0, t: 0 })
  const active = useRef(false)

  useEffect(() => {
    if (!open) {
      active.current = false
      moved.current = false
      setDragging(false)
      setDragY(0)
    }
  }, [open])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!isNarrow()) return
    const body = bodyRef.current
    if (!body || body.scrollTop > 1) return
    active.current = true
    moved.current = false
    start.current = { y: e.clientY, t: performance.now() }
    setDragging(true)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!active.current) return
    const dy = e.clientY - start.current.y
    // 只有真的向下拖够距离才进入跟手态：轻点/微抖不动画，
    // 否则 Content 上的 transform 会让落点偏移，Radix 可能连点击都吞掉
    if (dy < 6) return
    moved.current = true
    // 只跟下拉，上滑留给内容滚动
    setDragY(dy * 0.86)
  }, [])

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!active.current) return
    active.current = false
    setDragging(false)
    // 没真的拖起来就当普通点击处理，别抢按钮的事件序列
    if (!moved.current) {
      setDragY(0)
      return
    }
    const dy = e.clientY - start.current.y
    const velocity = dy / Math.max(1, performance.now() - start.current.t)
    if (dy > 90 || velocity > 0.5) {
      haptic('light')
      setDragY(0)
      onOpenChange(false)
    } else {
      setDragY(0)
    }
  }, [onOpenChange])

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-40 bg-black/30 overlay-fade"
          style={dragY > 0 ? { opacity: Math.max(0.3, 1 - dragY / 460) } : undefined}
        />
        <RadixDialog.Content
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
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragging ? 'none' : 'transform 260ms cubic-bezier(.2, 0, 0, 1)',
            ...(dragY || dragging ? {} : { animation: 'slide-up var(--dur-2) var(--ease-emph)' }),
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
          className={cn(
            'pop fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-5',
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
