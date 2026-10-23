/**
 * 应用自动更新：纯逻辑与平台判断（安卓 App / Windows 桌面版共用）。
 *
 * - 这里只放无副作用的函数（版本比较、解析 Release、挑 APK、镜像地址、每日检查节流），
 *   单测见 appUpdate.test.ts；
 * - 真正发请求 / 调原生的部分在 appUpdateClient.ts，按平台分支：
 *   安卓走 GitHub Releases + 原生 AppUpdate 插件下载安装 APK，
 *   桌面走 tauri-plugin-updater（latest.json + 签名校验）；
 * - 网页版（PWA）由 Service Worker 自己更新，不出现这些入口。
 */

export const REPO = 'ajie203b/personal-workstation'
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`
/** Pages 上的静态版本号（带 CORS，不吃 API 限流）；API 取不到时兜底用 */
export const PAGES_VERSION_URL = 'https://ajie203b.github.io/personal-workstation/version.json'
/**
 * GitHub 直连下载失败 / 20 秒没响应时依次尝试的镜像前缀（前缀 + 原始 github.com 地址）。
 * 镜像是第三方公益服务，随时可能失效；下载后原生侧会校验包名，拿到错误页不会去安装。
 */
export const DOWNLOAD_MIRRORS = ['https://ghfast.top/', 'https://gh-proxy.com/']

export type UpdatePlatform = 'android' | 'desktop' | 'web'

/** 平台分支：Tauri 桌面壳优先，其次 Capacitor 安卓，其余都算网页版 */
export function detectUpdatePlatform(env: { tauri: boolean; native: boolean; nativePlatform?: string }): UpdatePlatform {
  if (env.tauri) return 'desktop'
  if (env.native && (env.nativePlatform ?? 'android') === 'android') return 'android'
  return 'web'
}

/** 只接受 x.y.z（可带 v 前缀）形态，别把 HTML 错误页里的字符串当版本号 */
export function normalizeVersion(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const v = raw.trim().replace(/^v/i, '')
  return /^\d+(\.\d+)*$/.test(v) ? v : ''
}

/** 版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0（缺的段按 0 算：3.3 == 3.3.0） */
export function compareVersions(a: string, b: string): number {
  const pa = (normalizeVersion(a) || '0').split('.').map(Number)
  const pb = (normalizeVersion(b) || '0').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/** latest 比 current 新才算有更新；任何一方不是合法版本号都返回 false */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!normalizeVersion(latest) || !normalizeVersion(current)) return false
  return compareVersions(latest, current) > 0
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface LatestRelease {
  version: string
  tag: string
  notes: string
  publishedAt: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

/** 解析 GitHub `releases/latest` 的 JSON；草稿、预发布、版本号不合法都返回 null */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (!json || typeof json !== 'object') return null
  const d = json as Record<string, unknown>
  if (d.draft === true || d.prerelease === true) return null
  const tag = typeof d.tag_name === 'string' ? d.tag_name : ''
  const version = normalizeVersion(tag)
  if (!version) return null
  const assets: ReleaseAsset[] = Array.isArray(d.assets)
    ? d.assets.flatMap((a): ReleaseAsset[] => {
        if (!a || typeof a !== 'object') return []
        const r = a as Record<string, unknown>
        const name = typeof r.name === 'string' ? r.name : ''
        const url = typeof r.browser_download_url === 'string' ? r.browser_download_url : ''
        if (!name || !/^https:\/\//.test(url)) return []
        return [{ name, url, size: typeof r.size === 'number' ? r.size : 0 }]
      })
    : []
  return {
    version,
    tag,
    notes: typeof d.body === 'string' ? d.body.trim() : '',
    publishedAt: typeof d.published_at === 'string' ? d.published_at : '',
    htmlUrl: typeof d.html_url === 'string' ? d.html_url : RELEASE_PAGE,
    assets,
  }
}

/**
 * 从 Release 附件里挑 APK：优先发布脚本的固定命名 personal-workstation-vX.Y.Z.apk，
 * 其次任何带本版本号的 .apk，最后任意 .apk。
 */
export function pickApkAsset(assets: ReleaseAsset[], version: string): ReleaseAsset | null {
  const apks = assets.filter((a) => a.name.toLowerCase().endsWith('.apk'))
  if (!apks.length) return null
  const v = normalizeVersion(version)
  return (
    apks.find((a) => a.name === `personal-workstation-v${v}.apk`)
    ?? (v ? apks.find((a) => a.name.includes(v)) : undefined)
    ?? apks[0]
  )
}

/** API 取不到附件列表时按发布脚本的固定命名拼直链（release.ps1：personal-workstation-vX.Y.Z.apk） */
export function fallbackApkUrl(version: string): string {
  const v = normalizeVersion(version)
  return `https://github.com/${REPO}/releases/download/v${v}/personal-workstation-v${v}.apk`
}

/** 直连在前、镜像在后的下载地址列表；只有 github.com 的地址才套镜像前缀 */
export function mirrorUrls(url: string, mirrors: readonly string[] = DOWNLOAD_MIRRORS): string[] {
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url)) return [url]
  return [url, ...mirrors.map((m) => (m.endsWith('/') ? m : `${m}/`) + url)]
}

/** 启动自动检查节流：开关打开，且今天还没查过（lastDay 为 YYYY-MM-DD） */
export function shouldAutoCheck(opts: { enabled: boolean; lastCheckDay: string | null; today: string }): boolean {
  if (!opts.enabled) return false
  return opts.lastCheckDay !== opts.today
}

/** 更新说明转成纯文本展示：去掉 Markdown 的强调 / 代码 / 链接语法，过长截断 */
export function plainNotes(notes: string, maxLen = 1200): string {
  const text = notes
    .replace(/\r\n/g, '\n')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text
}

/** 下载进度百分比；总长未知（-1 / 0）时返回 null，界面显示不定进度 */
export function progressPercent(downloaded: number, total: number): number | null {
  if (!(total > 0)) return null
  return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)))
}
