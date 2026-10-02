import { useEffect, useRef, useState } from 'react'
import { Download, Monitor, Moon, Smartphone, Sun, Upload } from 'lucide-react'
import { useUi, type Theme } from '@/stores/ui'
import { clearAllData, exportAll, importAll } from '@/db/tasks'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { canInstall, onInstallAvailabilityChange, promptInstall } from '@/lib/pwa'
import { isNative } from '@/lib/native'
import { cn } from '@/lib/cn'

type Tab = 'appearance' | 'data' | 'about'

const THEME_CARDS: { value: Theme; label: string; icon: typeof Sun; preview: [string, string] }[] = [
  { value: 'light', label: '浅色', icon: Sun, preview: ['#FFFFFF', '#0B57D0'] },
  { value: 'dark', label: '深色', icon: Moon, preview: ['#1E1F24', '#A8C7FA'] },
  { value: 'system', label: '跟随系统', icon: Monitor, preview: ['#EDEDF0', '#1E1F24'] },
]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('appearance')
  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-5 enter">
      <h1 className="text-[22px] font-bold leading-8">设置</h1>
      <Segmented
        ariaLabel="设置分区"
        value={tab}
        onChange={setTab}
        className="self-start"
        options={[
          { value: 'appearance', label: '外观' },
          { value: 'data', label: '数据' },
          { value: 'about', label: '关于' },
        ]}
      />
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'about' && <AboutTab />}
    </div>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useUi()
  return (
    <div className="flex flex-col gap-3 max-w-xl">
      <p className="text-[13px] text-on-surface-2 px-1">主题即时生效，仅保存在本机浏览器。</p>
      <div className="grid grid-cols-3 gap-3">
        {THEME_CARDS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setTheme(c.value)}
            className={cn(
              'card card-hover p-3.5 flex flex-col items-center gap-2.5 cursor-pointer',
              theme === c.value && 'ring-2 ring-primary',
            )}
            aria-pressed={theme === c.value}
          >
            <span className="flex gap-1 h-10 items-center justify-center w-full">
              <span className="w-7 h-7 rounded-lg border border-outline" style={{ background: c.preview[0] }} />
              <span className="w-7 h-7 rounded-lg -ml-3" style={{ background: c.preview[1] }} />
            </span>
            <span className="text-[13px] font-medium flex items-center gap-1.5">
              <c.icon size={14} /> {c.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function DataTab() {
  const [usage, setUsage] = useState<string>('')
  const [clearOpen, setClearOpen] = useState(false)
  const toast = useUi((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.estimate?.().then((est) => {
      if (est?.usage != null) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)} MB`)
    })
  }, [])

  const doExport = async () => {
    const json = await exportAll()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `个人工作站备份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('备份已导出')
  }

  const doImport = async (file: File) => {
    try {
      const json = await file.text()
      const r = await importAll(json)
      toast(`已导入 ${r.tasks} 条任务`)
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : '文件无法解析'}`)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">备份与恢复</h2>
        <p className="text-[12.5px] text-on-surface-2 mb-3.5 leading-relaxed">
          所有数据保存在本机浏览器（IndexedDB）。换设备或清除浏览器数据前，先导出 JSON 备份。
          {usage && ` 当前占用约 ${usage}。`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void doExport()}>
            <Download size={15} /> 导出备份
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> 导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
        </div>
      </section>

      <section className="card p-4" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--outline))' }}>
        <h2 className="text-[14px] font-semibold mb-1 text-danger">危险区</h2>
        <p className="text-[12.5px] text-on-surface-2 mb-3">删除本机全部任务与设置，不可撤销。</p>
        <Button variant="danger" size="sm" onClick={() => setClearOpen(true)}>
          清空所有数据
        </Button>
      </section>

      <Dialog open={clearOpen} onOpenChange={setClearOpen} title="清空所有数据？" description="本机 IndexedDB 中的任务与设置将被永久删除。建议先导出备份。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setClearOpen(false)}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              void clearAllData().then(() => {
                setClearOpen(false)
                toast('数据已清空')
              })
            }}
          >
            确认清空
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function AboutTab() {
  const [installable, setInstallable] = useState(canInstall())
  useEffect(() => onInstallAvailabilityChange(() => setInstallable(canInstall())), [])

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {isNative() ? (
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold mb-1.5">安装状态</h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            已作为安卓应用安装运行 · 数据保存在应用沙箱内，卸载应用会同时删除数据，重要节点请先到「数据」页导出备份。
          </p>
        </section>
      ) : (
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold mb-1.5">安装到设备</h2>
          <p className="text-[12.5px] text-on-surface-2 mb-3 leading-relaxed">
            {installable
              ? '检测到安装能力，点击下方按钮即可安装为独立应用（安卓桌面图标 / 桌面端窗口）。'
              : '若按钮不可用：安卓 Chrome 打开本站 → 菜单「添加到主屏幕/安装应用」；电脑浏览器地址栏右侧可点「安装」。'}
          </p>
          <Button variant="primary" size="sm" disabled={!installable} onClick={() => void promptInstall()}>
            <Smartphone size={15} /> 安装应用
          </Button>
        </section>
      )}

      <section className="card p-4 text-[12.5px] text-on-surface-2 leading-relaxed">
        <h2 className="text-[14px] font-semibold text-on-surface mb-1.5">关于</h2>
        <p>个人工作站 v0.1.0 · 本地优先 · 数据不出本机</p>
        <p className="mt-1">
          技术栈：React 18 + TypeScript + Vite + Tailwind CSS 4 + Zustand + Dexie（IndexedDB）+ PWA
        </p>
        <p className="mt-1">路线：M1 任务清单 ✅ → M2 文档工作站 → M3 AI 助手面板 → M4 互跳与打磨</p>
      </section>
    </div>
  )
}
