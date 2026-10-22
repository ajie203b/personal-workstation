import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'

export interface SelectMenuOption {
  value: string
  label: string
}

interface SelectMenuProps {
  value: string
  onChange: (value: string) => void
  options: SelectMenuOption[]
  ariaLabel: string
  /** 触发按钮上的文案；缺省按 value 从 options 里取 */
  display?: string
  placeholder?: string
  /** 手机底部浮层的标题（桌面下拉不显示） */
  title?: string
  triggerClassName?: string
  contentClassName?: string
  /** 桌面菜单相对触发按钮的对齐（默认左对齐） */
  align?: 'start' | 'center' | 'end'
}

/**
 * 自绘单选下拉：替代原生 <select>。
 *
 * 安卓 WebView 的原生 select 弹窗是系统深色单选框，跟应用画风完全不搭；
 * 这里桌面从触发按钮「长出来」（缩放+淡入），手机从底部「升起来」（底部浮层，
 * 与 Sheet / TimePicker 同一形态语言），选项按 --stagger 依次浮现、选完轻收。
 * 全程只动 scale / translate / opacity，不碰 Radix 定位用的 transform。
 */
export function SelectMenu({
  value,
  onChange,
  options,
  ariaLabel,
  display,
  placeholder = '请选择',
  title,
  triggerClassName,
  contentClassName,
  align = 'start',
}: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  const displayText = display ?? current?.label ?? ''

  return (
    <RadixMenu.Root open={open} onOpenChange={setOpen}>
      <RadixMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex items-center gap-1.5 min-w-0 cursor-pointer select-none text-left',
            'bg-surface-2 border border-outline rounded-[10px] text-on-surface',
            'h-9 px-3 text-[13px] outline-none focus:border-primary/60',
            'active:scale-[0.98] transition-[transform,border-color] duration-150',
            triggerClassName,
          )}
        >
          <span className={cn('flex-1 truncate', !displayText && 'text-on-surface-2')}>
            {displayText || placeholder}
          </span>
          <ChevronDown
            size={14}
            className={cn('shrink-0 text-on-surface-2 transition-transform duration-150', open && 'rotate-180')}
          />
        </button>
      </RadixMenu.Trigger>

      <RadixMenu.Portal>
        {/* Portal 带 asChild（Slot 只收单个子元素），遮罩与菜单用 Fragment 包一层 */}
        <>
          {/* 手机端轻遮罩：只压暗背景提示「这是浮层」；关闭由 Radix 的外点/Esc 负责 */}
          {open && (
            <div aria-hidden className="fixed inset-0 z-40 bg-black/25 overlay-fade md:hidden pointer-events-none" />
          )}
          <RadixMenu.Content
            side="bottom"
            sideOffset={6}
            align={align}
            collisionPadding={12}
            className={cn(
              'select-menu pop z-50 p-1.5 max-h-[72dvh] overflow-y-auto overscroll-contain',
              'min-w-[180px] max-w-[min(340px,88vw)]',
              open ? 'select-menu-open' : 'select-menu-closed',
              contentClassName,
            )}
          >
            {title && (
              <div className="md:hidden px-3 pt-2 pb-1 text-[12px] text-on-surface-2 tracking-wide">{title}</div>
            )}
            <RadixMenu.RadioGroup
              value={value}
              onValueChange={(v) => {
                haptic('light')
                onChange(v)
              }}
            >
              {options.map((o, i) => (
                <RadixMenu.RadioItem
                  key={o.value}
                  value={o.value}
                  className={cn(
                    'select-row group flex items-center gap-2.5 px-3 h-11 md:h-10 rounded-[10px] cursor-pointer outline-none select-none',
                    'transition-colors duration-150 data-[highlighted]:bg-surface-3',
                  )}
                  style={{ ['--i' as string]: Math.min(i, 6) }}
                >
                  {/* 单选圈：选中的小圆点轻轻弹出（不是只换个颜色） */}
                  <span
                    className={cn(
                      'grid place-items-center w-[17px] h-[17px] rounded-full border-[1.5px] shrink-0',
                      'transition-colors duration-150 border-outline group-data-[state=checked]:border-primary',
                    )}
                  >
                    <span
                      className={cn(
                        'w-[8px] h-[8px] rounded-full bg-primary transition-transform duration-150',
                        'scale-0 group-data-[state=checked]:scale-100',
                      )}
                      style={{ transitionTimingFunction: 'var(--ease-spring)' }}
                    />
                  </span>
                  <span className="flex-1 min-w-0 line-clamp-2 text-[13px] leading-snug">{o.label}</span>
                </RadixMenu.RadioItem>
              ))}
            </RadixMenu.RadioGroup>
          </RadixMenu.Content>
        </>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  )
}
