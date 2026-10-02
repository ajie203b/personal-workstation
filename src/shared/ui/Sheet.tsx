import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * 侧滑详情面板：桌面/平板横屏=右侧滑入（420px），手机=底部抽屉（85vh）。
 * Radix Dialog 保证焦点圈定、Esc 关闭等无障碍行为。
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
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-40 bg-black/30"
          style={{ animation: 'fade-in var(--dur-1) ease' }}
        />
        <RadixDialog.Content
          className={cn(
            'fixed z-50 bg-surface border-outline flex flex-col',
            'max-md:inset-x-0 max-md:bottom-0 max-md:h-[85dvh] max-md:rounded-t-[20px] max-md:border-t',
            'md:top-0 md:right-0 md:bottom-0 md:w-[min(440px,92vw)] md:border-l',
          )}
          style={{ animation: 'fade-up var(--dur-2) var(--ease-emph)' }}
        >
          <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-outline">
            <RadixDialog.Title className="text-[16px] font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="关闭"
              className="grid place-items-center w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <RadixDialog.Content className="pop fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(400px,92vw)] p-5">
          <RadixDialog.Title className="text-[17px] font-semibold">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1.5 text-[13.5px] text-on-surface-2 leading-relaxed">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
