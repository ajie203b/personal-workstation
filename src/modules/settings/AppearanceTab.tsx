import { Check } from 'lucide-react'
import { useUi, type Accent, type ThemeMode } from '@/stores/ui'
import { setThemeModeWithTransition } from '@/shared/theme'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented } from '@/shared/ui/Segmented'

/** Apple 系统设置 × Material 3 表现力强调色（与 index.css 中 data-accent 调板一致） */
const ACCENTS: { value: Accent; color: string; label: string }[] = [
  { value: 'blue', color: '#2563EB', label: '蓝色' },
  { value: 'purple', color: '#7C3AED', label: '紫色' },
  { value: 'pink', color: '#DB2777', label: '粉色' },
  { value: 'red', color: '#E11D48', label: '红色' },
  { value: 'orange', color: '#D97706', label: '橙色' },
  { value: 'green', color: '#059669', label: '绿色' },
]

export function AppearanceTab() {
  const themeMode = useUi((s) => s.themeMode)
  const accent = useUi((s) => s.accent)
  const setAccent = useUi((s) => s.setAccent)
  const motion = useUi((s) => s.motion)
  const setMotion = useUi((s) => s.setMotion)
  const haptics = useUi((s) => s.haptics)
  const setHaptics = useUi((s) => s.setHaptics)
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useUi((s) => s.setSidebarCollapsed)

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">主题</h2>
        <p className="text-[13px] text-on-surface-2 mb-3">跟随系统会在系统切换深浅色时自动变化。</p>
        <Segmented
          ariaLabel="主题模式"
          asRadio
          touchSized
          value={themeMode}
          onChange={(v) => setThemeModeWithTransition(v as ThemeMode)}
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">强调色</h2>
        <p className="text-[13px] text-on-surface-2 mb-3">用于主按钮、链接、选中状态与番茄钟。完成保持绿色，删除与错误保持红色。</p>
        <div className="flex flex-wrap gap-1.5">
          {ACCENTS.map((a) => {
            const active = accent === a.value
            return (
              <button
                key={a.value}
                type="button"
                title={a.label}
                aria-label={`强调色：${a.label}`}
                aria-pressed={active}
                onClick={() => setAccent(a.value)}
                className="grid size-11 place-items-center rounded-full press transition-transform duration-150 hover:scale-110 cursor-pointer"
              >
                <span
                  aria-hidden
                  className="grid place-items-center size-7.5 rounded-full text-white transition-shadow duration-200"
                  style={{
                    background: `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${a.color} 78%, white), ${a.color} 72%)`,
                    boxShadow: active
                      ? `0 0 0 2.5px var(--surface), 0 0 0 4.5px ${a.color}, 0 6px 14px -4px ${a.color}`
                      : 'inset 0 1px 1px rgba(255,255,255,0.45), 0 2px 6px -2px rgba(15,23,42,0.22)',
                  }}
                >
                  {active && <Check size={14} strokeWidth={2.8} />}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="card p-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">动效</h2>
          <p className="text-[13px] text-on-surface-2 mt-0.5">关闭后应用内动画减至最弱。</p>
        </div>
        <JellySwitch checked={motion} onChange={() => setMotion(!motion)} label="动效" />
      </section>

      <section className="card p-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">触觉反馈</h2>
          <p className="text-[13px] text-on-surface-2 mt-0.5">勾选、拖拽、长按确认时轻振一下；没有振动马达的设备不受影响。</p>
        </div>
        <JellySwitch checked={haptics} onChange={() => setHaptics(!haptics)} label="触觉反馈" />
      </section>

      <section className="card p-4 hidden md:flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">桌面侧栏默认收起</h2>
          <p className="text-[13px] text-on-surface-2 mt-0.5">开启后桌面端只显示图标栏，把横向空间让给内容；随时可在侧栏左下角展开。</p>
        </div>
        <JellySwitch checked={sidebarCollapsed} onChange={() => setSidebarCollapsed(!sidebarCollapsed)} label="侧栏默认收起" />
      </section>
    </div>
  )
}
