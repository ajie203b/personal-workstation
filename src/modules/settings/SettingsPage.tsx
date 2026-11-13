import { useState } from 'react'
import { ChevronRight, Database, Info, Lightbulb, Palette, RefreshCw } from 'lucide-react'
import { BackButton } from '@/shared/ui/BackButton'
import { cn } from '@/lib/cn'
import { AppearanceTab } from './AppearanceTab'
import { DataTab } from './DataTab'
import { SyncTab } from './SyncTab'
import { FeedbackTab } from './FeedbackTab'
import { AboutTab } from './AboutTab'

type Tab = 'appearance' | 'data' | 'sync' | 'feedback' | 'about'

const SECTIONS: { id: Tab; label: string; hint: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: '外观', hint: '主题、强调色、动效', icon: Palette },
  { id: 'data', label: '数据', hint: '备份、恢复、数据安全', icon: Database },
  { id: 'sync', label: '同步', hint: '用坚果云跨设备共用数据', icon: RefreshCw },
  { id: 'feedback', label: '建议', hint: '你希望添加的功能', icon: Lightbulb },
  { id: 'about', label: '关于', hint: '版本、更新、安装', icon: Info },
]

/**
 * 设置：桌面是「左侧分区 + 右侧内容」（macOS 系统设置那套），
 * 手机是「一级列表 → 点进二级页」，不再用顶部分段选择器（三个选项还行，四个就挤了）。
 */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('appearance')
  const [mobileOpen, setMobileOpen] = useState(false)

  const content = tab === 'appearance' ? <AppearanceTab />
    : tab === 'data' ? <DataTab onGoSync={() => setTab('sync')} />
    : tab === 'sync' ? <SyncTab />
    : tab === 'feedback' ? <FeedbackTab />
    : <AboutTab />

  return (
    <div className="mx-auto w-full max-w-4xl px-4 md:px-8 pt-4 pb-24 md:pb-14 enter">
      <h1 className="hidden md:block text-[22px] font-bold leading-8 mb-4">设置</h1>

      <div className="flex flex-col md:flex-row md:gap-8 md:items-start">
        {/* 桌面：分区列表 */}
        <nav className="hidden md:flex md:flex-col md:w-44 md:shrink-0 gap-0.5 md:sticky md:top-2" aria-label="设置分区">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTab(s.id)}
              className={cn(
                'flex items-center gap-2.5 h-9 px-2.5 rounded-[9px] text-[13px] text-left transition-colors cursor-pointer',
                tab === s.id ? 'bg-primary-soft text-primary font-medium' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
              )}
            >
              <s.icon size={15} className="shrink-0" />
              {s.label}
            </button>
          ))}
        </nav>

        {/* 手机：一级列表 */}
        {!mobileOpen && (
          <div className="md:hidden flex flex-col gap-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setTab(s.id); setMobileOpen(true) }}
                className="card flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer"
              >
                <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-3 text-on-surface-2 shrink-0">
                  <s.icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{s.label}</span>
                  <span className="block text-[12px] text-on-surface-2 mt-0.5 truncate">{s.hint}</span>
                </span>
                <ChevronRight size={16} className="text-on-surface-2 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* 内容：手机二级页才显示，桌面常显 */}
        <div className={cn('flex-1 min-w-0 md:block', mobileOpen ? 'block' : 'hidden')}>
          {mobileOpen && (
            <BackButton text="设置" label="返回设置" onClick={() => setMobileOpen(false)} className="md:hidden mb-3" />
          )}
          {content}
        </div>
      </div>
    </div>
  )
}
