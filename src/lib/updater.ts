const UPDATE_URL = 'https://ajie203b.github.io/personal-workstation-site/version.json'

export interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  currentVersion: string
  apkUrl: string
}

/** 获取当前版本号（Vite define 注入） */
export function getCurrentVersion(): string {
  return __APP_VERSION__
}

/** 检查更新：从站点仓库拉取 version.json 比对 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = getCurrentVersion()
  try {
    const res = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return { hasUpdate: false, latestVersion: current, currentVersion: current, apkUrl: RELEASE_PAGE }
    const data = (await res.json()) as { version?: string }
    const latest = data.version ?? current
    const hasUpdate = compareVersions(latest, current) > 0
    const apkUrl = `https://github.com/ajie203b/personal-workstation-site/releases/latest/download/personal-workstation.apk`
    return { hasUpdate, latestVersion: latest, currentVersion: current, apkUrl }
  } catch {
    return { hasUpdate: false, latestVersion: current, currentVersion: current, apkUrl: RELEASE_PAGE }
  }
}

const RELEASE_PAGE = 'https://github.com/ajie203b/personal-workstation/releases/latest'

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

/** 打开 APK 下载链接（系统浏览器） */
export function openDownload(url: string): void {
  window.open(url, '_blank')
}
