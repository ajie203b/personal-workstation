export interface UpdateInfo {
  hasUpdate: boolean
  /** 是否真的查到了远端版本；false 时界面提示「暂时没查到」而不是冒充已是最新 */
  checked: boolean
  latestVersion: string
  currentVersion: string
  apkUrl: string
}

/**
 * 网页版查同源 version.json（由 deploy-gh-pages.sh 写入 Pages），浏览器环境一定拿得到 CORS；
 * 安卓壳内同源是 app 包内的 localhost，读不到该文件，降级到 Releases API。
 * 不再依赖任何写死的 Pages 域名。
 */
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
  const fromJson = await readVersionJson(current)
  if (fromJson?.checked) return fromJson
  const fromApi = await readLatestRelease(current)
  return fromApi ?? NOT_CHECKED(current)
}

async function readVersionJson(current: string): Promise<UpdateInfo | null> {
  try {
    // 只在 http(s) 环境试同源；安卓壳内（capacitor://localhost 等）协议不同，直接走 Releases API
    const base = document.baseURI
    if (!/^https?:/i.test(base)) return null
    const res = await fetch(new URL('version.json', base).href + `?t=${Date.now()}`, { cache: 'no-store' })
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

/** 打开下载链接（系统浏览器） */
export function openDownload(url: string): void {
  window.open(url, '_blank')
}
