import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/cn'
import { useSheetDrag } from './useSheetDrag'

const BACKDROP = 'modal-backdrop fixed inset-0 z-40 bg-black/30'

/**
 * 侧滑详情面板：桌面/平板横屏=右侧滑入（440px），手机=底部抽屉（85dvh）。
 * Radix Dialog 保证焦点圈定、Esc 关闭等无障碍行为。
 *
 * 手机从把手往下拖，桌面从标题栏往右拖。内容区可以独立滚动。
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  compact = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  compact?: boolean
}) {
  const { panelRef, overlayRef, handle } = useSheetDrag(open, () => onOpenChange(false), true)
  const returnFocus = useRef<HTMLElement | null>(null)

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay ref={overlayRef} className={BACKDROP} />
        <RadixDialog.Content
          ref={panelRef}
          data-app-modal="sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement as HTMLElement | null
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current?.focus({ preventScroll: true })
          }}
          className={cn(
            'sheet-panel fixed z-50 bg-surface border-outline flex flex-col',
            'max-md:inset-x-0 max-md:bottom-0 max-md:rounded-t-[20px] max-md:border-t max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
            compact ? 'max-md:max-h-[85dvh]' : 'max-md:h-[85dvh]',
            'md:top-0 md:right-0 md:bottom-0 md:w-[min(440px,92vw)] md:border-l',
            'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
          )}
        >
          <div className="sheet-grabber md:hidden" aria-hidden {...handle}>
            <span />
          </div>
          <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-outline md:touch-none md:select-none md:cursor-grab" {...handle}
            onPointerDown={(event) => {
              if (window.matchMedia('(min-width: 768px)').matches) handle.onPointerDown(event)
            }}>
            <RadixDialog.Title className="text-[16px] font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="关闭"
              className="grid place-items-center size-11 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
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
  mobileSheet = false,
  initialFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  /** 默认 400px；宽短弹窗传 w-[min(620px,92vw)] */
  widthClass?: string
  mobileSheet?: boolean
  initialFocus?: RefObject<HTMLElement>
}) {
  const descriptionId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const { panelRef, overlayRef, handle } = useSheetDrag(open, () => onOpenChange(false))
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay ref={overlayRef} className={BACKDROP} />
        <RadixDialog.Content
          ref={panelRef}
          data-app-modal="dialog"
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={(event) => {
            returnFocus.current = document.activeElement as HTMLElement | null
            event.preventDefault()
            const target = initialFocus?.current ?? titleRef.current
            target?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current?.focus({ preventScroll: true })
          }}
          className={cn(
            'dialog-panel pop fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-5',
            // 矮视口/宽弹窗（添加任务 620px）时内容会顶出屏幕且无法滚动
            'flex flex-col max-h-[min(86dvh,720px)] overflow-y-auto overscroll-contain',
            widthClass,
            mobileSheet && 'mobile-dialog-sheet max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
          )}
        >
          {mobileSheet && <div aria-hidden className="sheet-grabber md:hidden -mx-5 -mt-5 mb-1" {...handle}><span /></div>}
          <div className="flex items-start justify-between gap-3">
            <RadixDialog.Title ref={titleRef} tabIndex={-1} className="min-w-0 text-[17px] font-semibold outline-none">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="关闭"
              className="grid place-items-center size-11 -mt-1 -mr-1 shrink-0 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
            >
              <X size={18} aria-hidden />
            </RadixDialog.Close>
          </div>
          {description && (
            <RadixDialog.Description id={descriptionId} className="mt-1.5 text-[13px] text-on-surface-2 leading-relaxed">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
