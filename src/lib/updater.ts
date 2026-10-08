export interface UpdateInfo {
  hasUpdate: boolean
  /** 是否真的查到了远端版本；false 时（限流/网络异常/无 release）界面不显示版本号 */
  checked: boolean
  latestVersion: string
  currentVersion: string
  apkUrl: string
}

const NOT_CHECKED = (current: string): UpdateInfo => ({
  hasUpdate: false,
  checked: false,
  latestVersion: '',
  currentVersion: current,
  apkUrl: RELEASE_PAGE,
})

/**
 * 最新版信息取自主仓库的 GitHub Releases API：
 * 不依赖任何托管域名，网页版和安卓壳内（https://localhost）都能查；
 * 站点仓库停用后，这里也不再读 Pages 上的 version.json。
 */
const LATEST_RELEASE_API = 'https://api.github.com/repos/ajie203b/personal-workstation/releases/latest'
export const RELEASE_PAGE = 'https://github.com/ajie203b/personal-workstation/releases/latest'

/** 获取当前版本号（Vite define 注入） */
export function getCurrentVersion(): string {
  return __APP_VERSION__
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = getCurrentVersion()
  try {
    const res = await fetch(`${LATEST_RELEASE_API}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return NOT_CHECKED(current)
    const data = (await res.json()) as {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    if (!/^\d+(\.\d+)*$/.test(latest)) return NOT_CHECKED(current)
    // 资产名带版本号（personal-workstation-v1.4.1.apk），按实际返回取，别拼死路径
    const apk = data.assets?.find((a) => a.name?.endsWith('.apk'))?.browser_download_url
    return {
      hasUpdate: compareVersions(latest, current) > 0,
      checked: true,
      latestVersion: latest,
      currentVersion: current,
      apkUrl: apk ?? RELEASE_PAGE,
    }
  } catch {
    return NOT_CHECKED(current)
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

/** 打开 APK 下载链接（系统浏览器） */
export function openDownload(url: string): void {
  window.open(url, '_blank')
}
