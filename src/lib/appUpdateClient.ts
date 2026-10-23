import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Update } from '@tauri-apps/plugin-updater'
import { isNative, isTauri } from './native'
import { todayStr } from './date'
import {
  DOWNLOAD_MIRRORS, LATEST_RELEASE_API, PAGES_VERSION_URL,
  detectUpdatePlatform, fallbackApkUrl, isNewerVersion, normalizeVersion, parseLatestRelease, pickApkAsset,
  progressPercent, shouldAutoCheck, type LatestRelease, type UpdatePlatform,
} from './appUpdate'

/**
 * 应用内自动更新：按平台分支。
 *
 * - 桌面版（Tauri）：tauri-plugin-updater 读 Release 上的 latest.json，下载安装包并校验签名，
 *   NSIS 被动模式安装后自动重启（Windows 上 install 会直接退出当前进程）。
 * - 安卓 App：读 GitHub Releases 最新版，原生 AppUpdate 插件下载 APK 到私有缓存
 *   （GitHub 20 秒没响应换镜像），再用 FileProvider 拉起系统安装器。
 * - 网页版：不参与（Service Worker 自己更新）。
 */

export function getUpdatePlatform(): UpdatePlatform {
  return detectUpdatePlatform({ tauri: isTauri(), native: isNative(), nativePlatform: Capacitor.getPlatform() })
}

/** 只有安卓 App 和桌面版才有应用内更新 */
export function supportsInAppUpdate(): boolean {
  return getUpdatePlatform() !== 'web'
}

export function getCurrentAppVersion(): string {
  return __APP_VERSION__
}

// ---------- 设置：启动自动检查 ----------

const AUTO_KEY = 'kairos.update.autoCheck'
const LAST_DAY_KEY = 'kairos.update.lastCheckDay'

export function getAutoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

export function setAutoCheckEnabled(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch { /* 隐私模式等写不进就算了 */ }
}

/** 启动时该不该静默检查：安卓每天最多一次；桌面每次启动都查（Tauri 只请求一个小 JSON） */
export function shouldAutoCheckNow(platform: UpdatePlatform = getUpdatePlatform()): boolean {
  if (platform === 'web') return false
  const enabled = getAutoCheckEnabled()
  if (platform === 'desktop') return enabled
  let last: string | null = null
  try { last = localStorage.getItem(LAST_DAY_KEY) } catch { /* ignore */ }
  return shouldAutoCheck({ enabled, lastCheckDay: last, today: todayStr() })
}

function markCheckedToday(): void {
  try { localStorage.setItem(LAST_DAY_KEY, todayStr()) } catch { /* ignore */ }
}

// ---------- 统一结果 ----------

export interface AvailableUpdate {
  platform: 'android' | 'desktop'
  version: string
  currentVersion: string
  notes: string
  /** 安卓：APK 直链与大小 */
  apkUrl?: string
  apkSize?: number
  /** 桌面：tauri-plugin-updater 的 Update 句柄 */
  tauriUpdate?: Update
}

export type CheckResult =
  | { status: 'latest'; currentVersion: string }
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'error'; currentVersion: string; message: string }

export interface InstallProgress {
  downloaded: number
  total: number
  /** null：总长未知 */
  percent: number | null
  phase: 'downloading' | 'installing'
}

export type InstallOutcome =
  /** 安卓：已拉起系统安装器 */
  | 'installer-started'
  /** 安卓：需要先允许「安装未知应用」，已跳到设置页 */
  | 'need-permission'
  /** 桌面：安装程序已启动，应用即将重启 */
  | 'restarting'

let checking: Promise<CheckResult> | null = null

/** 启动检查与手动检查共用同一结果，避免同时创建两份原生句柄。 */
export function checkAppUpdate(): Promise<CheckResult> {
  if (!checking) checking = performCheck().finally(() => { checking = null })
  return checking
}

async function performCheck(): Promise<CheckResult> {
  const platform = getUpdatePlatform()
  const currentVersion = getCurrentAppVersion()
  try {
    if (platform === 'desktop') return await checkDesktop(currentVersion)
    if (platform === 'android') {
      const r = await checkAndroid(currentVersion)
      markCheckedToday()
      return r
    }
    return { status: 'error', currentVersion, message: '网页版会自动更新，无需手动检查' }
  } catch (e) {
    return { status: 'error', currentVersion, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function installAppUpdate(
  update: AvailableUpdate,
  onProgress: (p: InstallProgress) => void,
): Promise<InstallOutcome> {
  return update.platform === 'desktop'
    ? installDesktop(update, onProgress)
    : installAndroid(update, onProgress)
}

/** 放弃这次更新时释放 Rust 侧持有的资源（桌面） */
export function disposeUpdate(update: AvailableUpdate | null | undefined): void {
  void update?.tauriUpdate?.close().catch(() => undefined)
}

// ---------- 桌面（Tauri） ----------

async function checkDesktop(currentVersion: string): Promise<CheckResult> {
  const { check } = await import('@tauri-apps/plugin-updater')
  let update: Update | null
  try {
    update = await check({ timeout: 20_000 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 还没配置签名密钥的版本，Release 上没有 latest.json：别把 404 原样甩给用户
    if (/404|not found|valid release json/i.test(msg)) {
      throw new Error('最新版本暂未提供自动更新文件，可前往发布页手动下载')
    }
    throw new Error(`检查更新失败：${msg}`)
  }
  if (!update) return { status: 'latest', currentVersion }
  return {
    status: 'available',
    update: {
      platform: 'desktop',
      version: normalizeVersion(update.version) || update.version,
      currentVersion,
      notes: update.body ?? '',
      tauriUpdate: update,
    },
  }
}

async function installDesktop(update: AvailableUpdate, onProgress: (p: InstallProgress) => void): Promise<InstallOutcome> {
  const u = update.tauriUpdate
  if (!u) throw new Error('更新信息已失效，请重新检查')
  let downloaded = 0
  let total = 0
  await u.download((ev) => {
    if (ev.event === 'Started') total = ev.data.contentLength ?? 0
    else if (ev.event === 'Progress') downloaded += ev.data.chunkLength
    onProgress({ downloaded, total, percent: progressPercent(downloaded, total), phase: 'downloading' })
  })
  onProgress({ downloaded, total, percent: 100, phase: 'installing' })
  // Windows：启动 NSIS（被动模式）后当前进程会退出，安装完自动重新打开
  await u.install()
  // 其他平台 / 安装器没有自动重启时兜底
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
  return 'restarting'
}

// ---------- 安卓 ----------

interface DownloadProgressEvent {
  downloaded: number
  total: number
  source: string
}

interface AppUpdatePlugin {
  /** 原生 OkHttp GET（网页 fetch 被拦 / 超时的兜底） */
  checkUpdate(options: { url: string }): Promise<{ status: number; body: string }>
  downloadApk(options: {
    url: string
    mirrors: string[]
    fileName: string
    expectedVersion: string
    timeoutMs?: number
  }): Promise<{ path: string; size: number; source: string; versionName?: string }>
  installApk(options: { path: string; expectedVersion: string }): Promise<{ status: 'started' | 'needPermission' }>
  canInstallPackages(): Promise<{ granted: boolean }>
  openInstallPermissionSettings(): Promise<void>
  addListener(event: 'downloadProgress', cb: (e: DownloadProgressEvent) => void): Promise<PluginListenerHandle>
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate')

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    window.clearTimeout(timer)
  }
}

async function readLatestRelease(): Promise<LatestRelease | null> {
  try {
    const r = parseLatestRelease(await fetchJson(LATEST_RELEASE_API, 15_000))
    if (r) return r
  } catch { /* 走原生兜底 */ }
  try {
    const res = await AppUpdate.checkUpdate({ url: LATEST_RELEASE_API })
    if (res.status >= 200 && res.status < 300) return parseLatestRelease(JSON.parse(res.body))
  } catch { /* 再走 Pages */ }
  return null
}

async function checkAndroid(currentVersion: string): Promise<CheckResult> {
  const release = await readLatestRelease()
  if (release) {
    if (!isNewerVersion(release.version, currentVersion)) return { status: 'latest', currentVersion }
    const apk = pickApkAsset(release.assets, release.version)
    return {
      status: 'available',
      update: {
        platform: 'android',
        version: release.version,
        currentVersion,
        notes: release.notes,
        apkUrl: apk?.url ?? fallbackApkUrl(release.version),
        apkSize: apk?.size,
      },
    }
  }
  // GitHub API 被限流 / 不通：退回 Pages 上的 version.json，APK 地址按固定命名拼
  try {
    const data = (await fetchJson(PAGES_VERSION_URL, 15_000)) as { version?: string }
    const latest = normalizeVersion(data?.version)
    if (latest) {
      if (!isNewerVersion(latest, currentVersion)) return { status: 'latest', currentVersion }
      return {
        status: 'available',
        update: { platform: 'android', version: latest, currentVersion, notes: '', apkUrl: fallbackApkUrl(latest) },
      }
    }
  } catch { /* fallthrough */ }
  return { status: 'error', currentVersion, message: '暂时没查到版本信息（网络或 GitHub 接口限流），稍后再试' }
}

/** 已下载好的 APK 路径（同一会话内授权回来后重试安装，不用重新下载） */
let downloadedApk: { version: string; path: string } | null = null

async function installAndroid(update: AvailableUpdate, onProgress: (p: InstallProgress) => void): Promise<InstallOutcome> {
  if (!update.apkUrl) throw new Error('没有找到安装包地址')
  let path = downloadedApk?.version === update.version ? downloadedApk.path : ''
  if (!path) {
    const handle = await AppUpdate.addListener('downloadProgress', (e) => {
      onProgress({ downloaded: e.downloaded, total: e.total, percent: progressPercent(e.downloaded, e.total), phase: 'downloading' })
    })
    try {
      const res = await AppUpdate.downloadApk({
        url: update.apkUrl,
        mirrors: DOWNLOAD_MIRRORS,
        fileName: `kairos-${update.version}.apk`,
        expectedVersion: update.version,
        timeoutMs: 20_000,
      })
      path = res.path
      downloadedApk = { version: update.version, path }
    } finally {
      void handle.remove()
    }
  }
  onProgress({ downloaded: 1, total: 1, percent: 100, phase: 'installing' })
  try {
    // 每次安装都让原生重验，包括从系统授权页返回后的缓存复用。
    const r = await AppUpdate.installApk({ path, expectedVersion: update.version })
    return r.status === 'needPermission' ? 'need-permission' : 'installer-started'
  } catch (e) {
    downloadedApk = null
    throw e
  }
}

/** 安卓：是否已允许本应用「安装未知应用」 */
export async function canInstallPackages(): Promise<boolean> {
  if (getUpdatePlatform() !== 'android') return false
  try {
    return (await AppUpdate.canInstallPackages()).granted
  } catch {
    return false
  }
}
