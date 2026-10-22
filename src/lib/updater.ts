import { openExternal } from './links'

export interface UpdateInfo {
  hasUpdate: boolean
  /** 是否真的查到了远端版本；false 时界面提示「暂时没查到」而不是冒充已是最新 */
  checked: boolean
  latestVersion: string
  currentVersion: string
  apkUrl: string
}

/**
 * 版本号的权威来源是 Pages 上的 version.json（由 deploy-gh-pages.sh 按 package.json 写入 gh-pages）。
 * 它是静态文件、带 Access-Control-Allow-Origin: *，网页版和安卓壳内（https://localhost）都能直接读，
 * 且不吃 GitHub API 的按 IP 限流——所以放主位。Releases API 只用来在「确实有新版」时取 APK 直链，
 * 取不到就退回 Release 页面，用户照样能下载。
 */
const PAGES_VERSION_URL = 'https://ajie203b.github.io/personal-workstation/version.json'
const LATEST_RELEASE_API = 'https://api.github.com/repos/ajie203b/personal-workstation/releases/latest'
export const RELEASE_PAGE = 'https://github.com/ajie203b/personal-workstation/releases/latest'

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

/** 只接受 x.y.z 形态的版本号，避免把 HTML 错误页里的字符串当版本比较 */
function normalizeVersion(raw: string): string {
  const v = raw.replace(/^v/, '').trim()
  return /^\d+(\.\d+)*$/.test(v) ? v : ''
}

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

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/** 打开下载链接（系统浏览器；安卓壳里 window.open 会静默失败，走 openExternal） */
export function openDownload(url: string): void {
  openExternal(url)
}
