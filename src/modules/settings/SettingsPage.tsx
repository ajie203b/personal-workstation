import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Download, History, Smartphone, Upload } from 'lucide-react'
import { useUi, type Accent, type Density, type ThemeMode } from '@/stores/ui'
import { clearAllData, exportAll, importAll } from '@/db/tasks'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { HoldToConfirm } from '@/shared/ui/HoldToConfirm'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented } from '@/shared/ui/Segmented'
import { canInstall, onInstallAvailabilityChange, promptInstall } from '@/lib/pwa'
import { checkForUpdate, getCurrentVersion, openDownload, type UpdateInfo } from '@/lib/updater'
import { isNative } from '@/lib/native'
import { getNotifyEnabled, requestNotifyPermission, setNotifyEnabled } from '@/lib/notify'
import {
  getAutoBackupEnabled, listBackups, restoreBackup, setAutoBackupEnabled, writeSnapshot,
  type BackupInfo,
} from '@/lib/autoBackup'

type Tab = 'appearance' | 'data' | 'about'

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('appearance')
  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-5 enter">
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

/** macOS 系统设置同款强调色（与 index.css 中 data-accent 调板的浅色值一致） */
const ACCENTS: { value: Accent; color: string; label: string }[] = [
  { value: 'blue', color: '#0A6CFE', label: '蓝色' },
  { value: 'purple', color: '#7D4FBE', label: '紫色' },
  { value: 'pink', color: '#D6417B', label: '粉色' },
  { value: 'red', color: '#D63C41', label: '红色' },
  { value: 'orange', color: '#E07B1F', label: '橙色' },
  { value: 'green', color: '#2F9E5F', label: '绿色' },
]

function AppearanceTab() {
  const themeMode = useUi((s) => s.themeMode)
  const setThemeMode = useUi((s) => s.setThemeMode)
  const accent = useUi((s) => s.accent)
  const setAccent = useUi((s) => s.setAccent)
  const density = useUi((s) => s.density)
  const setDensity = useUi((s) => s.setDensity)
  const motion = useUi((s) => s.motion)
  const setMotion = useUi((s) => s.setMotion)

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">主题</h2>
        <p className="text-[13px] text-on-surface-2 mb-3">跟随系统会在系统切换深浅色时自动变化。</p>
        <Segmented
          ariaLabel="主题模式"
          value={themeMode}
          onChange={(v) => setThemeMode(v as ThemeMode)}
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">强调色</h2>
        <p className="text-[13px] text-on-surface-2 mb-3">用于按钮、链接与高亮元素。</p>
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              title={a.label}
              aria-label={`强调色：${a.label}`}
              aria-pressed={accent === a.value}
              onClick={() => setAccent(a.value)}
              className="w-7 h-7 rounded-full press transition-transform duration-150 hover:scale-110"
              style={{
                background: a.color,
                boxShadow: accent === a.value ? '0 0 0 2px var(--surface), 0 0 0 4px var(--on-surface-2)' : undefined,
              }}
            />
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-3">界面密度</h2>
        <Segmented
          ariaLabel="界面密度"
          value={density}
          onChange={(v) => setDensity(v as Density)}
          options={[
            { value: 'compact', label: '紧凑' },
            { value: 'default', label: '默认' },
            { value: 'large', label: '宽松' },
          ]}
        />
      </section>

      <section className="card p-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">动效</h2>
          <p className="text-[13px] text-on-surface-2 mt-0.5">关闭后应用内动画减至最弱。</p>
        </div>
        <JellySwitch checked={motion} onChange={() => setMotion(!motion)} label="动效" />
      </section>
    </div>
  )
}

function DataTab() {
  const [usage, setUsage] = useState<string>('')
  const toast = useUi((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.estimate?.().then((est) => {
      if (est?.usage != null) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)} MB`)
    })
  }, [])

  const { state: exportState, run: runExport } = useAsyncButton()

  const doExport = async () => {
    try {
      await runExport(async () => {
        const json = await exportAll()
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `个人工作站备份-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        toast('备份已导出')
      })
    } catch {
      toast('导出失败，请重试')
    }
  }

  const { state: importState, run: runImport } = useAsyncButton()

  const doImport = async (file: File) => {
    try {
      await runImport(async () => {
        const json = await file.text()
        const r = await importAll(json)
        toast(`已导入 ${r.tasks} 条任务`)
      })
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : '文件无法解析'}`)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {/* 提醒通知（仅安卓 App 生效） */}
      {isNative() && <NotifyCard />}

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">备份与恢复</h2>
        <p className="text-[13px] text-on-surface-2 mb-3.5 leading-relaxed">
          所有数据保存在本机浏览器（IndexedDB）。换设备或清除浏览器数据前，先导出 JSON 备份。
          {usage && ` 当前占用约 ${usage}。`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" state={exportState} onClick={() => void doExport()}>
            <Download size={15} /> 导出备份
          </Button>
          <Button variant="outline" size="sm" state={importState} onClick={() => fileRef.current?.click()}>
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

      <AutoBackupCard />

      <section className="card p-4" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--outline))' }}>
        <h2 className="text-[14px] font-semibold mb-1 text-danger">危险区</h2>
        <p className="text-[13px] text-on-surface-2 mb-3">删除本机全部任务与设置，不可撤销。按住 1.5 秒才会执行（键盘用户会走二次确认）。</p>
        <HoldToConfirm
          label="清空所有数据"
          className="h-10 px-5"
          dialogTitle="清空所有数据？"
          dialogDescription="本机 IndexedDB 中的任务与设置将被永久删除。建议先导出备份。"
          onConfirm={() => void clearAllData().then(() => toast('数据已清空'))}
        />
      </section>
    </div>
  )
}

/** 提醒通知开关（仅安卓 App 内渲染） */
function NotifyCard() {
  const [on, setOn] = useState(false)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    void getNotifyEnabled().then(setOn)
  }, [])

  const toggle = async () => {
    if (!on) {
      const granted = await requestNotifyPermission()
      if (!granted) {
        toast('未获得通知权限，请在系统设置中允许')
        return
      }
    }
    await setNotifyEnabled(!on)
    setOn(!on)
    toast(!on ? '已开启到期提醒' : '已关闭到期提醒')
  }
  const sendTest = async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.schedule({
        notifications: [{
          id: 1999999999,
          title: '测试通知',
          body: '如果你看到这条通知，说明到期提醒已就绪 ✓',
          schedule: { at: new Date(Date.now() + 1500) },
        }],
      })
      toast('已发送，约 2 秒后弹出')
    } catch {
      toast('发送失败：请检查通知权限')
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold mb-0.5 inline-flex items-center gap-1.5">
            {on ? <Bell size={14} /> : <BellOff size={14} />} 到期提醒
          </h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            任务到期时发送系统通知（按截止时间，默认 09:00）。
          </p>
        </div>
        <JellySwitch checked={on} onChange={() => void toggle()} label="到期提醒" />
      </div>
      {on && (
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={() => void sendTest()}>
            <Bell size={14} /> 发送测试通知
          </Button>
        </div>
      )}
    </section>
  )
}

/** 自动备份：OPFS 滚动快照（保留最近 3 份）+ 恢复 */
function AutoBackupCard() {
  const [on, setOn] = useState(true)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const toast = useUi((s) => s.toast)

  const refresh = () => {
    void listBackups().then((list) => setBackups(list.filter((b) => b.name.startsWith('snapshot-'))))
  }

  useEffect(() => {
    void getAutoBackupEnabled().then(setOn)
    refresh()
  }, [])

  const toggle = async () => {
    await setAutoBackupEnabled(!on)
    setOn(!on)
    if (!on) {
      await writeSnapshot()
      refresh()
      toast('已开启自动备份，并生成一份快照')
    } else {
      toast('已关闭自动备份')
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold mb-0.5">自动备份</h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            每 24 小时打开应用时静默快照到本机私有存储，保留最近 3 份。不上传任何服务器。
          </p>
        </div>
        <JellySwitch checked={on} onChange={() => void toggle()} label="自动备份" />
      </div>

      {backups.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-[12px] text-on-surface-2 inline-flex items-center gap-1.5">
            <History size={12} /> 本机快照（点击恢复，覆盖当前数据）
          </p>
          {backups.map((b) => (
            <div key={b.name} className="flex items-center gap-2 h-9 px-3 rounded-[10px] bg-surface-2">
              <span className="flex-1 text-[12.5px] tabular-nums">
                {new Date(b.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                <span className="text-on-surface-2 ml-2">{(b.size / 1024).toFixed(0)} KB</span>
              </span>
              <HoldToConfirm
                variant="neutral"
                holdMs={1200}
                label="恢复"
                className="h-8 px-3"
                dialogTitle="恢复这份快照？"
                dialogDescription="当前数据将与之合并（同 id 覆盖）。建议先手动导出一份备份再恢复。"
                onConfirm={() => void restoreBackup(b.name).then(() => {
                  toast('已恢复快照')
                  refresh()
                })}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AboutTab() {
  const [installable, setInstallable] = useState(canInstall())
  useEffect(() => onInstallAvailabilityChange(() => setInstallable(canInstall())), [])
  const { state: checkState, run: runCheck } = useAsyncButton({ successHoldMs: 900 })
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  const doCheck = async () => {
    setUpdateInfo(null)
    try {
      await runCheck(async () => {
        const info = await checkForUpdate()
        setUpdateInfo(info)
        // 没真查到就别演成功，按钮落 error 态
        if (!info.checked) throw new Error('版本信息不可用')
      })
    } catch {
      /* 失败态已由按钮呈现 */
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {/* 更新检查 */}
      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1.5">软件更新</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[13px] text-on-surface-2">当前版本 {getCurrentVersion()}</span>
          <Button size="sm" variant="outline" state={checkState} onClick={() => void doCheck()}>
            检查更新
          </Button>
        </div>
        {updateInfo && (
          updateInfo.hasUpdate ? (
            <div className="mt-3 p-3 rounded-[10px] bg-primary-soft flex items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-primary">发现新版本 v{updateInfo.latestVersion}</p>
                <p className="text-[11px] text-on-surface-2 mt-0.5">当前 v{updateInfo.currentVersion}</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => openDownload(updateInfo.apkUrl)}>
                下载 APK
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-on-surface-2">
              {updateInfo.checked ? `已是最新版（v${updateInfo.currentVersion}）` : '暂时没查到版本信息（网络或 GitHub 接口限流），稍后再试'}
            </p>
          )
        )}
      </section>

      {isNative() ? (
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold mb-1.5">安装状态</h2>
          <p className="text-[13px] text-on-surface-2 leading-relaxed">
            已作为安卓应用安装运行 · 数据保存在应用沙箱内，卸载应用会同时删除数据，重要节点请先到「数据」页导出备份。
          </p>
        </section>
      ) : (
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold mb-1.5">安装到设备</h2>
          <p className="text-[13px] text-on-surface-2 mb-3 leading-relaxed">
            {installable
              ? '检测到安装能力，点击下方按钮即可安装为独立应用（安卓桌面图标 / 桌面端窗口）。'
              : '若按钮不可用：安卓 Chrome 打开本站 → 菜单「添加到主屏幕/安装应用」；电脑浏览器地址栏右侧可点「安装」。'}
          </p>
          <Button variant="primary" size="sm" disabled={!installable} onClick={() => void promptInstall()}>
            <Smartphone size={15} /> 安装应用
          </Button>
        </section>
      )}
    </div>
  )
}
