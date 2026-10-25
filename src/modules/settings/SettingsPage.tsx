import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, ChevronRight, Database, Download, ExternalLink, Info, LayoutGrid, Lightbulb, Palette, RefreshCw, Smartphone, Upload } from 'lucide-react'
import { useUi, type Accent, type ThemeMode } from '@/stores/ui'
import { db } from '@/db/db'
import { exportAll, importAll } from '@/db/tasks'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Dialog } from '@/shared/ui/Sheet'
import { BackButton } from '@/shared/ui/BackButton'
import { Segmented } from '@/shared/ui/Segmented'
import { canInstall, onInstallAvailabilityChange, promptInstall } from '@/lib/pwa'
import { checkForUpdate, getCurrentVersion, openDownload, type UpdateInfo } from '@/lib/updater'
import { fmtDateTime, todayStr } from '@/lib/date'
import { openSavedAction, saveBlob } from '@/lib/saveFile'
import { openExternal } from '@/lib/links'
import { isNative, isTauri } from '@/lib/native'
import { supportsInAppUpdate } from '@/lib/appUpdateClient'
import { AppUpdateCard } from '@/shared/AppUpdate'
import { cn } from '@/lib/cn'
import { getNotifyEnabled, requestNotifyPermission, setNotifyEnabled } from '@/lib/notify'
import {
  JIANGUOYUN_URL, getLastSyncAt, getLastSyncError, getWebdavConfig, setWebdavConfig, syncNow,
  type SyncFailure, type WebdavConfig,
} from '@/lib/sync'

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

/** macOS 系统设置同款强调色（与 index.css 中 data-accent 调板的浅色值一致） */
const ACCENTS: { value: Accent; color: string; label: string }[] = [
  { value: 'blue', color: '#2C55B8', label: '蓝色' },
  { value: 'purple', color: '#7D4FBE', label: '紫色' },
  { value: 'pink', color: '#B53470', label: '粉色' },
  { value: 'red', color: '#D63C41', label: '红色' },
  { value: 'orange', color: '#A8510F', label: '橙色' },
  { value: 'green', color: '#247944', label: '绿色' },
]

function AppearanceTab() {
  const themeMode = useUi((s) => s.themeMode)
  const setThemeMode = useUi((s) => s.setThemeMode)
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
        <p className="text-[13px] text-on-surface-2 mb-3">用于主按钮、链接、选中状态与番茄钟。完成保持绿色，删除与错误保持红色。</p>
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

      <section className="card p-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">桌面侧栏默认收起</h2>
          <p className="text-[13px] text-on-surface-2 mt-0.5">开启后桌面端只显示图标栏，把横向空间让给内容；随时可在侧栏左上角展开。</p>
        </div>
        <JellySwitch checked={sidebarCollapsed} onChange={() => setSidebarCollapsed(!sidebarCollapsed)} label="侧栏默认收起" />
      </section>
    </div>
  )
}

/**
 * 功能建议：不自动提交，只把标题和正文预填进 GitHub 新建 Issue 页面。
 * 需要用户先有 GitHub 账号并在网页上点提交，避免应用持有任何 token。
 */
function FeedbackTab() {
  const toast = useUi((s) => s.toast)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')

  const trimmedDetails = details.trim()
  const derivedTitle = (title.trim() || trimmedDetails.split('\n')[0]?.trim() || '').slice(0, 80)
  const canSend = derivedTitle.length > 0

  const send = () => {
    if (!canSend) {
      toast('先写一句想要的功能')
      return
    }
    const platform = isNative() ? 'Android App' : isTauri() ? 'Windows 桌面版' : '网页版'
    const body = [
      trimmedDetails || '（请补充使用场景 / 期望效果）',
      '',
      '---',
      `提交环境：Kairos v${getCurrentVersion()} · ${platform}`,
    ].join('\n')
    const url = 'https://github.com/ajie203b/personal-workstation/issues/new'
      + `?title=${encodeURIComponent(`功能建议：${derivedTitle}`)}`
      + `&body=${encodeURIComponent(body)}`
    openExternal(url)
    toast('已打开 GitHub，确认内容后提交即可')
  }

  const inputCls = 'w-full rounded-[10px] bg-surface-2 border border-outline px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 transition-colors'

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <section className="card p-4 flex flex-col gap-3">
        <div>
          <h2 className="text-[14px] font-semibold mb-0.5 inline-flex items-center gap-1.5">
            <Lightbulb size={15} className="text-on-surface-2" /> 你希望添加的功能
          </h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            写下想要的功能、使用场景或需求。点击后在 GitHub 打开新建 Issue 页面，
            标题和正文已经填好；确认无误再点「Submit new issue」提交。
          </p>
        </div>
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">一句话概括（可选）</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="例如：任务支持按项目分组"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">详细说明</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1200}
            rows={6}
            placeholder={'想解决什么问题？\n希望它怎么工作？\n有什么替代方案？'}
            className={cn(inputCls, 'resize-y min-h-[132px]')}
          />
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-on-surface-2 tabular-nums">{details.length}/1200</span>
          <Button variant="primary" size="sm" className="ml-auto" disabled={!canSend} onClick={send}>
            <ExternalLink size={15} /> 去 GitHub 提交
          </Button>
        </div>
        <p className="text-[11px] text-on-surface-2/80 leading-relaxed">
          不会自动提交，也不会上传你的任务或文档内容；正文里只附带应用版本和平台信息。
        </p>
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">先看看大家的建议</h2>
        <p className="text-[12.5px] text-on-surface-2 leading-relaxed mb-3">
          已有需求和问题都在 GitHub Issues 里，提交前可以先搜一下，避免重复。
        </p>
        <Button variant="outline" size="sm" onClick={() => openExternal('https://github.com/ajie203b/personal-workstation/issues')}>
          <ExternalLink size={15} /> 浏览 GitHub Issues
        </Button>
      </section>
    </div>
  )
}

const LAST_BACKUP_KEY = 'lastManualBackupAt'
const BACKUP_REMIND_MS = 7 * 24 * 60 * 60 * 1000

function DataTab({ onGoSync }: { onGoSync: () => void }) {
  const [usage, setUsage] = useState<string>('')
  const [lastBackup, setLastBackup] = useState<number | null>(null)
  const toast = useUi((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.estimate?.().then((est) => {
      if (est?.usage != null) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)} MB`)
    })
    void db.settings.get(LAST_BACKUP_KEY).then((row) => {
      if (typeof row?.value === 'number') setLastBackup(row.value)
    })
  }, [])

  const backupStale = lastBackup == null || Date.now() - lastBackup > BACKUP_REMIND_MS
  const { state: exportState, run: runExport } = useAsyncButton()

  const doExport = async () => {
    try {
      await runExport(async () => {
        const json = await exportAll()
        const blob = new Blob([json], { type: 'application/json' })
        // 本地日期，别用 toISOString（UTC 会让凌晨导出的文件名变成昨天）
        const where = await saveBlob(blob, `个人工作站备份-${todayStr()}.json`)
        const at = Date.now()
        setLastBackup(at)
        void db.settings.put({ key: LAST_BACKUP_KEY, value: at }).catch(() => undefined)
        toast(`备份已导出 → ${where}`, openSavedAction())
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
        toast(r.warnings.length ? `已导入 ${r.tasks} 条任务；${r.warnings[0]}` : `已导入 ${r.tasks} 条任务`)
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
          所有数据保存在本机（IndexedDB）。换设备、清除浏览器数据或卸载应用前，先导出一份 JSON 备份。
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
        <div
          className={cn(
            'mt-3 rounded-[10px] px-3 py-2 text-[12px] leading-relaxed',
            backupStale ? 'bg-p1/10 text-p1' : 'bg-ok/10 text-ok',
          )}
        >
          {lastBackup
            ? `上次导出：${fmtDateTime(lastBackup)}`
            : '还没有导出过备份'}
          {backupStale ? ' · 建议现在导出一次，之后每周一次即可' : ' · 备份状态良好'}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">数据安全</h2>
        <ul className="text-[12.5px] text-on-surface-2 leading-relaxed flex flex-col gap-1.5">
          <li>· 任务、文档、批注都只保存在本机，不会上传到任何服务器。</li>
          <li>· 每周导出一次 JSON 备份，文件会落在「下载/个人工作站」，重装或换机后可导入恢复。</li>
          <li>· 想在手机和电脑之间自动共用一份数据，可以开启坚果云同步，云端会保留副本。</li>
        </ul>
        <Button variant="outline" size="sm" className="mt-3" onClick={onGoSync}>
          <RefreshCw size={15} /> 去开启同步
        </Button>
      </section>
    </div>
  )
}

/** 同步分区：坚果云预设，只填账号和应用密码 */
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
  const [pending, setPending] = useState<number | null>(null)
  const [exact, setExact] = useState<boolean | null>(null)
  const [perm, setPerm] = useState<string | null>(null)
  const toast = useUi((s) => s.toast)

  const refreshStatus = async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const [p, e, perms] = await Promise.all([
        LocalNotifications.getPending(),
        LocalNotifications.checkExactNotificationSetting().catch(() => ({ exact_alarm: 'denied' as const })),
        LocalNotifications.checkPermissions(),
      ])
      setPending(Array.isArray(p.notifications) ? p.notifications.length : 0)
      setExact(e.exact_alarm === 'granted')
      setPerm(perms.display)
    } catch {
      setPending(null)
      setExact(false)
      setPerm(null)
    }
  }

  useEffect(() => {
    void getNotifyEnabled().then((v) => {
      setOn(v)
      if (v) void refreshStatus()
    })
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
    // setNotifyEnabled 内部会把已有任务一起重排，旧任务不用等下次启动
    await setNotifyEnabled(true)
    setOn(true)
    toast('已开启到期提醒')
    void refreshStatus()
  }

  const toggle = async () => {
    if (on) {
      await setNotifyEnabled(false)
      setOn(false)
      setPending(0)
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
          // 精确闹钟未授权时不能让测试卡在系统设置页；非精确也能很快弹
          schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
          isExactNotification: false,
        }],
      })
      toast('已发送，约 2 秒后弹出')
      window.setTimeout(() => void refreshStatus(), 2500)
    } catch {
      toast('发送失败：请检查通知权限')
    }
  }

  const openExactSetting = async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.changeExactNotificationSetting()
      await refreshStatus()
    } catch {
      toast('无法打开系统设置')
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
            任务设置截止日期后，到期时发系统通知（没填时间默认 09:00）；未完成的任务才会提醒。
          </p>
        </div>
        <JellySwitch checked={on} onChange={() => void toggle()} label="到期提醒" />
      </div>
      {on && (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void sendTest()}>
              <Bell size={14} /> 发送测试通知
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refreshStatus()}>
              刷新状态
            </Button>
          </div>
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
            {perm != null && perm !== 'granted'
              ? '系统通知权限未开启，请到系统设置里允许'
              : pending == null
                ? '正在读取提醒状态…'
                : pending > 0
                  ? `已登记 ${pending} 条本地提醒`
                  : '当前没有可排期的提醒（任务需要设置截止日期）'}
            {exact === false && ' · 系统未允许精确闹钟，提醒可能晚几分钟'}
          </p>
          {exact === false && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => void openExactSetting()}>
              开启精确提醒
            </Button>
          )}
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


/**
 * 坚果云同步：默认只填账号 + 应用密码，目录固定为 JIANGUOYUN_URL；
 * 用别家 WebDAV 的在「高级」里改地址。口令只存本机，不随同步/备份导出。
 */
function WebdavCard() {
  const toast = useUi((s) => s.toast)
  const [cfg, setCfg] = useState<WebdavConfig>({ url: JIANGUOYUN_URL, username: '', password: '', auto: true })
  const [last, setLast] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [lastError, setLastError] = useState<SyncFailure | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([getWebdavConfig(), getLastSyncAt(), getLastSyncError()]).then(([c, l, err]) => {
      if (c) setCfg({ ...c, url: c.url || JIANGUOYUN_URL })
      setLast(l)
      setLastError(err)
    })
  }, [])

  const custom = cfg.url.trim() !== '' && cfg.url.trim() !== JIANGUOYUN_URL
  const ready = cfg.username.trim() !== '' && cfg.password !== ''

  const persist = async (next: WebdavConfig) => {
    const fixed = { ...next, url: next.url.trim() || JIANGUOYUN_URL }
    setCfg(fixed)
    await setWebdavConfig(fixed)
  }
  const patch = (p: Partial<WebdavConfig>) => void persist({ ...cfg, ...p })

  const sync = async () => {
    if (busy) return
    if (!ready) {
      setNote({ ok: false, text: '请先填写坚果云账号和应用密码' })
      return
    }
    setBusy(true)
    setNote(null)
    await persist(cfg)
    try {
      const r = await syncNow()
      setLast(r.at)
      setLastError(null)
      setNote({
        ok: true,
        text: `已同步：${r.tasks} 条任务、${r.docs} 篇文档（上传 ${r.blobsUp} / 下载 ${r.blobsDown} 个文件）`
          + (r.pendingLocal > 0 ? `；另有 ${r.pendingLocal} 条同步期间的改动已保留，下次同步会推送` : ''),
      })
      toast('同步完成')
    } catch (e) {
      const text = e instanceof Error ? e.message : '同步失败'
      setNote({ ok: false, text })
      setLastError({ at: Date.now(), message: text })
      toast(text)
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full h-10 px-3 rounded-[10px] bg-surface border border-outline text-[13px] outline-none focus:border-primary/60'

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold mb-0.5">坚果云同步</h2>
        <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
          手机和电脑填同一个坚果云账号，就共用同一份任务、文档和批注。应用密码在坚果云网页版
          「账户信息 → 安全选项 → 第三方应用管理」里生成，不是登录密码。
        </p>
      </div>

      {!isNative() && !isTauri() && (
        <p className="text-[12.5px] leading-relaxed text-danger">
          网页版受浏览器跨域限制，连不上坚果云。电脑上请安装 Windows 桌面版（GitHub Releases 里的 Kairos 安装包），手机用安卓 App。
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">坚果云账号</span>
          <input
            value={cfg.username}
            onChange={(e) => setCfg({ ...cfg, username: e.target.value })}
            onBlur={() => patch({ username: cfg.username.trim() })}
            placeholder="注册邮箱或手机号"
            autoComplete="username"
            className={inputCls}
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
            className={inputCls}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[12.5px] text-on-surface-2">
          <JellySwitch checked={cfg.auto} onChange={() => patch({ auto: !cfg.auto })} label="自动同步" />
          打开应用时自动同步（间隔 ≥ 10 分钟）
        </label>
        <Button variant="primary" size="sm" state={busy ? 'loading' : 'idle'} onClick={() => void sync()}>
          立即同步
        </Button>
      </div>

      {note && (
        <p className={cn('text-[12px] leading-relaxed', note.ok ? 'text-primary' : 'text-danger')}>{note.text}</p>
      )}
      {!note && lastError && (
        <p className="text-[12px] leading-relaxed text-danger">
          上次同步失败（{fmtDateTime(lastError.at)}）：{lastError.message}
        </p>
      )}
      <p className="text-[11.5px] text-on-surface-2">{last ? `上次同步：${fmtDateTime(last)}` : '还没有同步过'}</p>

      <details className="group" open={custom || undefined}>
        <summary className="cursor-pointer select-none text-[12px] text-on-surface-2 list-none flex items-center gap-1">
          <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
          高级：使用其他 WebDAV
        </summary>
        <label className="block mt-2">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">目录地址（留空即坚果云）</span>
          <input
            value={custom ? cfg.url : ''}
            onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
            onBlur={() => patch({ url: cfg.url })}
            placeholder={JIANGUOYUN_URL}
            className={inputCls}
          />
        </label>
      </details>
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
      {/* 更新检查：安卓 App / 桌面版是应用内下载安装；网页版保持原来的版本检查（PWA 自己会更新） */}
      {supportsInAppUpdate() ? <AppUpdateCard /> : (
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
      )}

      {isNative() ? (
        <>
          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-1.5 inline-flex items-center gap-1.5">
              <LayoutGrid size={15} className="text-on-surface-2" /> 桌面 / 负一屏小组件
            </h2>
            <p className="text-[13px] text-on-surface-2 leading-relaxed">
              「今日待办」小组件只留今天的任务和大加号，打卡任务仍会显示 2/3 进度。右上「+」直接弹出添加框，勾选圈直接完成并撒花，都不用打开 App；点标题才定位到那条任务，数据会在下次打开 App 或回到前台时自动同步。
            </p>
            <ol className="mt-2.5 flex flex-col gap-1.5 text-[12.5px] text-on-surface-2 leading-relaxed list-decimal pl-4">
              <li>桌面：长按空白处 →「添加工具 / 小组件」→ 找到「Kairos · 今日待办」拖出来。</li>
              <li>小米负一屏：右滑到最左 → 点右上「+」→ 小部件 → 滑到列表最底部，进「安卓小组件 / 安卓小部件」分类 → 找「今日待办」。</li>
              <li>格子可以拉宽：2×2 显示 3 条，4×2 显示 4 条，会自动切换排版。</li>
            </ol>
            <p className="text-[11px] text-on-surface-2/80 mt-2">
              小米主池里的「努力适配中，请您耐心等待」是 MIUI 对未收录第三方卡片的占位提示，不是应用故障；请从最底部的「安卓小组件」分类添加，功能完整可用。找不到入口时，先把「系统桌面 / 智能助理」更新到最新版。
            </p>
          </section>

          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-1.5">安装状态</h2>
            <p className="text-[13px] text-on-surface-2 leading-relaxed">
              已作为安卓应用安装运行 · 数据保存在应用沙箱内，卸载应用会同时删除数据，重要节点请先到「数据」页导出备份。
            </p>
          </section>
        </>
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
