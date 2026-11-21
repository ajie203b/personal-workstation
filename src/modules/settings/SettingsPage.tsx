import { useLayoutEffect } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronRight, Database, Info, Lightbulb, Palette, RefreshCw } from 'lucide-react'
import { getSettingsSection, SETTINGS_TITLES, type SettingsSection } from '@/app/nav'
import { cn } from '@/lib/cn'
import { AppearanceTab } from './AppearanceTab'
import { DataTab } from './DataTab'
import { SyncTab } from './SyncTab'
import { FeedbackTab } from './FeedbackTab'
import { AboutTab } from './AboutTab'

const SECTIONS: { id: SettingsSection; hint: string; icon: typeof Palette }[] = [
  { id: 'appearance', hint: '主题、强调色、动效', icon: Palette },
  { id: 'data', hint: '备份、恢复、数据安全', icon: Database },
  { id: 'sync', hint: '用坚果云跨设备共用数据', icon: RefreshCw },
  { id: 'feedback', hint: '你希望添加的功能', icon: Lightbulb },
  { id: 'about', hint: '版本、更新、安装', icon: Info },
]

/**
 * 设置：桌面是「左侧分区 + 右侧内容」（macOS 系统设置那套），
 * 手机是「一级列表 → 点进二级页」，不再用顶部分段选择器（三个选项还行，四个就挤了）。
 */
export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const section = getSettingsSection(params.get('section'))
  const tab = section ?? 'appearance'
  const setTab = (section: SettingsSection) => setParams({ section })
  useLayoutEffect(() => { document.getElementById('main-scroll')?.scrollTo({ top: 0 }) }, [section])

  const content = tab === 'appearance' ? <AppearanceTab />
    : tab === 'data' ? <DataTab onGoSync={() => setTab('sync')} />
    : tab === 'sync' ? <SyncTab />
    : tab === 'feedback' ? <FeedbackTab />
    : <AboutTab />

  return (
    <div className={cn('mx-auto w-full max-w-4xl px-3.5 md:px-8 pt-3 md:pt-6 md:pb-14', section ? 'pb-10' : 'pb-24')}>
      <h1 className="hidden md:block text-[28px] font-semibold leading-tight tracking-tight mb-5">设置</h1>

      <div className="flex flex-col md:flex-row md:gap-8 md:items-start">
        {/* 桌面：悬浮卡片分区列表 */}
        <nav className="hidden md:flex md:flex-col md:w-48 md:shrink-0 gap-1 card p-2 md:sticky md:top-3" aria-label="设置分区">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={tab === s.id ? 'page' : undefined}
              onClick={() => setTab(s.id)}
              className={cn(
                'press flex items-center gap-2.5 h-10 px-3 rounded-[12px] text-[13.5px] text-left cursor-pointer transition-colors',
                tab === s.id
                  ? 'bg-primary-soft text-primary font-semibold'
                  : 'text-on-surface-2 hover:bg-surface-3/80 hover:text-on-surface',
              )}
            >
              <s.icon size={15} className="shrink-0" />
              {SETTINGS_TITLES[s.id]}
            </button>
          ))}
        </nav>

        {/* 手机：一级列表 */}
        {!section && (
          <nav aria-label="设置分区" className="card md:hidden flex flex-col overflow-hidden">
            {SECTIONS.map((s, index) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTab(s.id)}
                className="chrome-button relative flex min-h-16 items-center gap-3.5 px-4 py-3 text-left cursor-pointer focus-visible:-outline-offset-2"
              >
                {index > 0 && <span aria-hidden className="absolute top-0 left-[4rem] right-0 border-t border-outline/80" />}
                <span className="grid place-items-center w-9 h-9 rounded-[11px] bg-primary-soft/80 text-primary shrink-0">
                  <s.icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-5">{SETTINGS_TITLES[s.id]}</span>
                  <span className="block text-[12px] text-on-surface-2 mt-0.5">{s.hint}</span>
                </span>
                <ChevronRight size={16} className="text-on-surface-2 shrink-0" />
              </button>
            ))}
          </nav>
        )}

        {/* 内容：手机二级页才显示，桌面常显 */}
        <div className={cn('flex-1 min-w-0 md:block', section ? 'block' : 'hidden')}>
          {content}
        </div>
      </div>
    </div>
  )
}
