import { useCallback, useEffect, useState } from 'react'
import { Download, RotateCw } from 'lucide-react'
import { Dialog } from '@/shared/ui/Sheet'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { useAppUpdate } from '@/stores/appUpdate'
import { useUi } from '@/stores/ui'
import { openExternal } from '@/lib/links'
import { formatBytes } from '@/lib/format'
import { RELEASE_PAGE, plainNotes } from '@/lib/appUpdate'
import {
  canInstallPackages, checkAppUpdate, getAutoCheckEnabled, getCurrentAppVersion, getUpdatePlatform,
  disposeUpdate, installAppUpdate, setAutoCheckEnabled, shouldAutoCheckNow, supportsInAppUpdate,
  type AvailableUpdate,
  type CheckResult, type InstallProgress,
} from '@/lib/appUpdateClient'

/** 启动后等界面稳定再查，别和首屏数据加载 / 自动同步抢网络 */
const STARTUP_DELAY_MS = 6_000

function discardUnusedUpdate(update: AvailableUpdate) {
  // 同一检查的手动等待者先有机会接管结果，再回收未被采用的原生句柄。
  queueMicrotask(() => {
    const current = useAppUpdate.getState().update
    if (current === update || (update.tauriUpdate && current?.tauriUpdate === update.tauriUpdate)) return
    disposeUpdate(update)
  })
}

/**
 * 全局挂载：安卓 App / 桌面版启动后静默检查一次，有新版弹窗；网页版什么都不渲染。
 */
export function AppUpdateHost() {
  const supported = supportsInAppUpdate()
  const show = useAppUpdate((s) => s.show)

  useEffect(() => {
    if (!supported || !shouldAutoCheckNow()) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!shouldAutoCheckNow() || useAppUpdate.getState().busy) return
      void checkAppUpdate().then((r) => {
        // 静默检查：没新版 / 查失败都不打扰
        if (cancelled || !getAutoCheckEnabled()) {
          if (r.status === 'available') discardUnusedUpdate(r.update)
          return
        }
        if (r.status === 'available') show(r.update)
      })
    }, STARTUP_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [supported, show])

  if (!supported) return null
  return <AppUpdateDialog />
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; progress: InstallProgress | null }
  | { kind: 'need-permission' }
  | { kind: 'installer-started' }
  | { kind: 'restarting' }
  | { kind: 'error'; message: string }

function AppUpdateDialog() {
  const { update, open, setOpen, setBusy } = useAppUpdate()
  const toast = useUi((s) => s.toast)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const busy = phase.kind === 'working' || phase.kind === 'restarting'
  const platform = update?.platform

  // 换了一个更新（重新检查）就把界面状态清掉
  useEffect(() => {
    setPhase({ kind: 'idle' })
  }, [update])

  const start = useCallback(async () => {
    if (!update || useAppUpdate.getState().busy) return
    setBusy(true)
    setPhase({ kind: 'working', progress: null })
    try {
      const outcome = await installAppUpdate(update, (p) => setPhase({ kind: 'working', progress: p }))
      setPhase({ kind: outcome })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }, [update, setBusy])

  // 安卓：从「安装未知应用」设置页回来后，已授权就自动继续安装
  useEffect(() => {
    if (!open || phase.kind !== 'need-permission' || getUpdatePlatform() !== 'android') return
    let handle: { remove: () => Promise<void> } | undefined
    let disposed = false
    void import('@capacitor/app').then(async ({ App }) => {
      const h = await App.addListener('resume', () => {
        void canInstallPackages().then((ok) => {
          if (ok && !disposed) void start()
        })
      })
      if (disposed) void h.remove()
      else handle = h
    })
    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [open, phase.kind, start])

  const onOpenChange = (v: boolean) => {
    if (busy) {
      toast('正在下载更新，请稍候')
      return
    }
    // 关掉弹窗不释放 Update 句柄：设置页「查看更新」还会再打开同一个更新
    setOpen(v)
  }

  if (!update) return null
  const notes = plainNotes(update.notes)
  const actionLabel = platform === 'desktop' ? '立即更新' : '下载并安装'
  const sizeText = update.apkSize ? ` · 安装包 ${formatBytes(update.apkSize)}` : ''

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`发现新版本 v${update.version}`}
      description={`当前版本 v${update.currentVersion}${sizeText}`}
    >
      <div className="rounded-[10px] bg-surface-2 p-3 max-h-[40dvh] overflow-y-auto">
        <p className="text-[12px] font-medium text-on-surface-2 mb-1.5">更新说明</p>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {notes || '本次更新没有附带说明，可在发布页查看详情。'}
        </p>
      </div>

      {phase.kind === 'working' && <ProgressBar progress={phase.progress} />}

      {phase.kind === 'need-permission' && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-on-surface-2">
          需要允许 Kairos「安装未知应用」。已打开系统设置，开启后返回这里会自动继续；没有反应的话点「继续安装」。
        </p>
      )}
      {phase.kind === 'installer-started' && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-primary">
          已打开系统安装器，按提示点「更新 / 安装」即可，数据会保留。
        </p>
      )}
      {phase.kind === 'restarting' && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-primary">正在安装，完成后会自动重新打开 Kairos…</p>
      )}
      {phase.kind === 'error' && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-danger break-words">更新失败：{phase.message}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
        {phase.kind === 'error' && (
          <Button size="sm" variant="ghost" onClick={() => openExternal(RELEASE_PAGE)}>
            去发布页下载
          </Button>
        )}
        {!busy && phase.kind !== 'installer-started' && (
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            稍后
          </Button>
        )}
        {phase.kind === 'need-permission' ? (
          <Button size="sm" variant="primary" onClick={() => void start()}>
            <RotateCw size={14} /> 继续安装
          </Button>
        ) : phase.kind === 'installer-started' ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>关闭</Button>
            <Button size="sm" variant="primary" onClick={() => void start()}>
              <RotateCw size={14} /> 重新打开安装器
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            state={busy ? 'loading' : 'idle'}
            onClick={() => void start()}
          >
            <Download size={14} /> {phase.kind === 'error' ? '重试' : actionLabel}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

function ProgressBar({ progress }: { progress: InstallProgress | null }) {
  const pct = progress?.percent ?? null
  const label = !progress
    ? '正在连接…'
    : progress.phase === 'installing'
      ? '下载完成，正在启动安装…'
      : pct === null
        ? `已下载 ${formatBytes(progress.downloaded)}`
        : `已下载 ${pct}%（${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}）`
  return (
    <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={pct === null ? 'h-full w-1/3 bg-primary rounded-full animate-pulse' : 'h-full bg-primary rounded-full transition-[width] duration-200'}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11.5px] text-on-surface-2 tabular-nums">{label}</p>
    </div>
  )
}

/**
 * 设置 → 关于：当前版本 + 「检查更新」+ 启动自动检查开关。
 * 只在安卓 App / 桌面版渲染（调用方判断 supportsInAppUpdate）。
 */
export function AppUpdateCard() {
  const platform = getUpdatePlatform()
  const show = useAppUpdate((s) => s.show)
  const currentUpdate = useAppUpdate((s) => s.update)
  const setOpen = useAppUpdate((s) => s.setOpen)
  const { state, run } = useAsyncButton({ successHoldMs: 900 })
  const [result, setResult] = useState<CheckResult | null>(null)
  const [auto, setAuto] = useState(getAutoCheckEnabled)

  const doCheck = async () => {
    setResult(null)
    try {
      await run(async () => {
        const r = await checkAppUpdate()
        setResult(r)
        if (r.status === 'available') show(r.update)
        if (r.status === 'error') throw new Error(r.message)
      })
    } catch {
      /* 失败态由按钮呈现，原因写在下面 */
    }
  }

  const toggleAuto = () => {
    setAutoCheckEnabled(!auto)
    setAuto(!auto)
  }

  return (
    <section className="card p-4">
      <h2 className="text-[14px] font-semibold mb-1.5">软件更新</h2>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] text-on-surface-2">
          当前版本 v{getCurrentAppVersion()} · {platform === 'desktop' ? 'Windows 桌面版' : '安卓 App'}
        </span>
        <Button size="sm" variant="outline" state={state} onClick={() => void doCheck()}>
          检查更新
        </Button>
      </div>

      {result?.status === 'latest' && (
        <p className="mt-3 text-[13px] text-on-surface-2">已是最新版（v{result.currentVersion}）</p>
      )}
      {result?.status === 'available' && currentUpdate && (
        <div className="mt-3 p-3 rounded-[10px] bg-primary-soft flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-primary">发现新版本 v{currentUpdate.version}</p>
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>查看更新</Button>
        </div>
      )}
      {result?.status === 'error' && (
        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[12.5px] text-danger leading-relaxed min-w-0 flex-1">{result.message}</p>
          <Button size="sm" variant="ghost" onClick={() => openExternal(RELEASE_PAGE)}>打开发布页</Button>
        </div>
      )}

      <label className="mt-3 flex items-center gap-2 text-[12.5px] text-on-surface-2">
        <JellySwitch checked={auto} onChange={toggleAuto} label="启动时自动检查更新" />
        {platform === 'desktop' ? '启动时自动检查更新' : '启动时自动检查更新（每天最多一次）'}
      </label>
    </section>
  )
}
