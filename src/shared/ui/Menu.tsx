import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const DropdownMenu = RadixMenu.Root
export const DropdownMenuTrigger = RadixMenu.Trigger

export function MenuContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={6}
        align="end"
        className={cn(
          'pop z-50 min-w-[168px] p-1.5',
          className,
        )}
        style={{ animation: 'scale-in var(--dur-1) var(--ease-emph)', transformOrigin: 'top right' }}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  )
}

export function MenuItem({
  children,
  onSelect,
  danger,
  active,
}: {
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  active?: boolean
}) {
  return (
    <RadixMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-2 px-3 h-9 rounded-[10px] text-[13px] cursor-pointer outline-none select-none',
        'transition-colors duration-150',
        danger ? 'text-danger data-[highlighted]:bg-danger/10' : 'text-on-surface data-[highlighted]:bg-surface-3',
        active && 'text-primary',
      )}
    >
      {children}
    </RadixMenu.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pt-2 pb-1 text-[11px] text-on-surface-2 tracking-wide">{children}</div>
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="my-1 h-px bg-outline" />
}
