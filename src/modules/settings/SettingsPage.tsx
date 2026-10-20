import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, ChevronLeft, ChevronRight, Database, Download, History, Info, Palette, RefreshCw, Smartphone, Upload } from 'lucide-react'
import { useUi, type Accent, type Density, type IntelPlacement, type ThemeMode } from '@/stores/ui'
import { clearAllData, exportAll, importAll } from '@/db/tasks'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { HoldToConfirm } from '@/shared/ui/HoldToConfirm'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { canInstall, onInstallAvailabilityChange, promptInstall } from '@/lib/pwa'
import { checkForUpdate, getCurrentVersion, openDownload, type UpdateInfo } from '@/lib/updater'
import { todayStr } from '@/lib/date'
import { isNative } from '@/lib/native'
import { cn } from '@/lib/cn'
import { getNotifyEnabled, requestNotifyPermission, setNotifyEnabled } from '@/lib/notify'
import {
  getAutoBackupEnabled, listBackups, restoreBackup, setAutoBackupEnabled, writeSnapshot,
  type BackupInfo,
} from '@/lib/autoBackup'
import {
  getLastSyncAt, getWebdavConfig, setWebdavConfig, syncNow, testWebdav,
  type WebdavConfig,
} from '@/lib/sync'

type Tab = 'appearance' | 'data' | 'sync' | 'about'

const SECTIONS: { id: Tab; label: string; hint: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: '外观', hint: '主题、强调色、密度、动效', icon: Palette },
  { id: 'data', label: '数据', hint: '备份、自动快照、清空', icon: Database },
  { id: 'sync', label: '同步', hint: 'WebDAV 跨设备共用数据', icon: RefreshCw },
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
    : tab === 'data' ? <DataTab />
    : tab === 'sync' ? <SyncTab />
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
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="md:hidden mb-3 inline-flex items-center gap-1 text-[13px] text-on-surface-2 hover:text-on-surface cursor-pointer"
            >
              <ChevronLeft size={15} /> 设置
            </button>
          )}
          {content}
        </div>
      </div>
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
  const intelPlacement = useUi((s) => s.intelPlacement)
  const setIntelPlacement = useUi((s) => s.setIntelPlacement)

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

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">模型智能排名</h2>
        <p className="text-[13px] text-on-surface-2 mb-3">Artificial Analysis 榜单卡片放在哪一页；数据每日自动更新。</p>
        <Segmented
          ariaLabel="模型智能排名位置"
          value={intelPlacement}
          onChange={(v) => setIntelPlacement(v as IntelPlacement)}
          options={[
            { value: 'today', label: '今日页' },
            { value: 'stats', label: '统计页' },
            { value: 'hidden', label: '隐藏' },
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
        // 本地日期，别用 toISOString（UTC 会让凌晨导出的文件名变成昨天）
        a.download = `个人工作站备份-${todayStr()}.json`
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

/** 同步分区：WebDAV 内容不少，单独一页，顶部就是上次同步时间与「立即同步」 */
function SyncTab() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <WebdavCard />
    </div>
  )
}

/** 提醒通知开关（仅安卓 App 内渲染） */
function NotifyCard() {
  const [on, setOn] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    void getNotifyEnabled().then(setOn)
  }, [])

  /**
   * 安卓上通知权限被拒一次就很难再要回来（系统会记成「已拒绝」，再弹也没有对话框），
   * 所以先用自己的说明卡讲清「为什么需要、发什么、能不能关」，用户点了「开启」才弹系统框。
   */
  const ask = () => setAskOpen(true)

  const grant = async () => {
    setAskOpen(false)
    const granted = await requestNotifyPermission()
    if (!granted) {
      toast('未获得通知权限，请在系统设置中允许')
      return
    }
    await setNotifyEnabled(true)
    setOn(true)
    toast('已开启到期提醒')
  }

  const toggle = async () => {
    if (on) {
      await setNotifyEnabled(false)
      setOn(false)
      toast('已关闭到期提醒')
      return
    }
    ask()
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

      <Dialog
        open={askOpen}
        onOpenChange={setAskOpen}
        title="开启到期提醒需要通知权限"
        description="接下来系统会弹一个权限框，请在系统对话框里点「允许」。"
      >
        <div className="flex flex-col gap-3">
          <ul className="text-[13px] text-on-surface-2 leading-relaxed flex flex-col gap-1.5">
            <li>· 只在你设定的截止时间发一条本地通知，提醒哪件事到期了</li>
            <li>· 通知在本机生成，不经过任何服务器，也不含你的任务内容之外的信息</li>
            <li>· 随时可以在这里关掉，关掉后不再发</li>
          </ul>
          <p className="text-[12px] text-on-surface-2/80">安卓上拒绝过一次就不容易再要回来，所以先在这里说明清楚。</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAskOpen(false)}>以后再说</Button>
            <Button variant="primary" onClick={() => void grant()}>好的，去开启</Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}


/** WebDAV 同步（v2.0）：可选、本地优先；口令只存本机，不随同步/备份导出 */
function WebdavCard() {
  const toast = useUi((s) => s.toast)
  const [cfg, setCfg] = useState<WebdavConfig>({ url: '', username: '', password: '', auto: false })
  const [last, setLast] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null)

  useEffect(() => {
    void Promise.all([getWebdavConfig(), getLastSyncAt()]).then(([c, l]) => {
      if (c) setCfg(c)
      setLast(l)
    })
  }, [])

  const persist = async (next: WebdavConfig) => {
    setCfg(next)
    await setWebdavConfig(next)
  }
  const patch = (p: Partial<WebdavConfig>) => void persist({ ...cfg, ...p })

  const test = async () => {
    if (busy) return
    setBusy('test')
    setNote(null)
    const r = await testWebdav(cfg)
    setNote({ ok: r.ok, text: r.message })
    setBusy(null)
  }

  const sync = async () => {
    if (busy) return
    setBusy('sync')
    setNote(null)
    await setWebdavConfig(cfg)
    try {
      const r = await syncNow()
      setLast(r.at)
      setNote({ ok: true, text: `已同步：${r.tasks} 条任务、${r.docs} 篇文档（上传 ${r.blobsUp} / 下载 ${r.blobsDown} 个文件）` })
      toast('同步完成')
    } catch (e) {
      const text = e instanceof Error ? e.message : '同步失败'
      setNote({ ok: false, text })
      toast(text)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold mb-0.5">WebDAV 同步（可选）</h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            用坚果云等 WebDAV 目录在手机和电脑之间共用同一份数据。本地优先，不同步也能照常用；
            口令只存在本机，不随同步或备份导出。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">目录地址</span>
          <input
            value={cfg.url}
            onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
            onBlur={() => patch({ url: cfg.url })}
            placeholder="https://dav.jianguoyun.com/dav/个人工作站/"
            className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[12px] font-medium text-on-surface-2 mb-1">用户名</span>
            <input
              value={cfg.username}
              onChange={(e) => setCfg({ ...cfg, username: e.target.value })}
              onBlur={() => patch({ username: cfg.username })}
              autoComplete="username"
              className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-on-surface-2 mb-1">应用密码</span>
            <input
              value={cfg.password}
              onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
              onBlur={() => patch({ password: cfg.password })}
              type="password"
              autoComplete="current-password"
              className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary/60"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[12.5px] text-on-surface-2">
          <JellySwitch checked={cfg.auto} onChange={() => patch({ auto: !cfg.auto })} label="自动同步" />
          打开应用时自动同步（间隔 ≥ 10 分钟）
        </label>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" state={busy === 'test' ? 'loading' : 'idle'} onClick={() => void test()}>
            测试连接
          </Button>
          <Button variant="primary" size="sm" state={busy === 'sync' ? 'loading' : 'idle'} onClick={() => void sync()}>
            立即同步
          </Button>
        </div>
      </div>

      {note && (
        <p className={cn('text-[12px] leading-relaxed', note.ok ? 'text-ok' : 'text-danger')}>{note.text}</p>
      )}
      <p className="text-[11.5px] text-on-surface-2">
        {last ? `上次同步：${new Date(last).toLocaleString('zh-CN')}` : '还没有同步过'}
        {' · '}网页版需要 WebDAV 服务端允许跨域；安卓 App 内由原生请求，不受此限制
      </p>
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
                dialogDescription="将用这份快照替换当前数据：快照之后新增的记录会消失，快照之后删除的会回来。建议先手动导出一份备份。"
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
