import { openExternal } from './links'
import { isTauri } from './native'
import { LATEST_RELEASE_API, PAGES_VERSION_URL, RELEASE_PAGE, compareVersions, normalizeVersion } from './appUpdate'

export { RELEASE_PAGE }

export interface UpdateInfo {
  hasUpdate: boolean
  /** 是否真的查到了远端版本；false 时界面提示「暂时没查到」而不是冒充已是最新 */
  checked: boolean
  latestVersion: string
  currentVersion: string
  apkUrl: string
}

/**
 * 网页版的「检查更新」（安卓 App / 桌面版改用 appUpdateClient 的应用内更新）。
 *
 * 版本号的权威来源是 Pages 上的 version.json（由 deploy-gh-pages.sh 按 package.json 写入 gh-pages）。
 * 它是静态文件、带 Access-Control-Allow-Origin: *，网页版和安卓壳内（https://localhost）都能直接读，
 * 且不吃 GitHub API 的按 IP 限流——所以放主位。Releases API 只用来在「确实有新版」时取 APK 直链，
 * 取不到就退回 Release 页面，用户照样能下载。
 */
// 地址常量与版本比较共用 appUpdate.ts（安卓 / 桌面的应用内更新也用它们）

/** 获取当前版本号（Vite define 注入） */
export function getCurrentVersion(): string {
  return __APP_VERSION__
}

const NOT_CHECKED = (current: string): UpdateInfo => ({
  hasUpdate: false,
  checked: false,
  latestVersion: '',
  currentVersion: current,
  apkUrl: RELEASE_PAGE,
})

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = getCurrentVersion()
  const fromPages = await readVersionJson(current)
  if (fromPages?.checked) {
    if (!fromPages.hasUpdate) return fromPages
    const withApk = await readLatestRelease(current)
    return withApk?.checked ? { ...fromPages, apkUrl: withApk.apkUrl } : fromPages
  }
  return (await readLatestRelease(current)) ?? NOT_CHECKED(current)
}

async function readVersionJson(current: string): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${PAGES_VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    const latest = normalizeVersion(data.version ?? '')
    if (!latest) return null
    return buildInfo(latest, current, RELEASE_PAGE)
  } catch {
    return null
  }
}

async function readLatestRelease(current: string): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${LATEST_RELEASE_API}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const latest = normalizeVersion(data.tag_name ?? '')
    if (!latest) return null
    // 资产名带版本号（personal-workstation-v1.4.1.apk），按实际返回取，别拼死路径
    const apk = data.assets?.find((a) => a.name?.endsWith('.apk'))?.browser_download_url
    return buildInfo(latest, current, apk ?? RELEASE_PAGE)
  } catch {
    return null
  }
}

function buildInfo(latest: string, current: string, apkUrl: string): UpdateInfo {
  return {
    hasUpdate: compareVersions(latest, current) > 0,
    checked: true,
    latestVersion: latest,
    currentVersion: current,
    apkUrl,
  }
}

/** 打开下载链接（系统浏览器；安卓壳里 window.open 会静默失败，走 openExternal） */
export function openDownload(url: string): void {
  // 桌面版下载的是 Windows 安装包，不是 APK：统一去 Release 页面挑
  openExternal(isTauri() ? RELEASE_PAGE : url)
}
