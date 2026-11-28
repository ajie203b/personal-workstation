import { isNative, isTauri } from './native'

/**
 * 文档正文里的链接（v2.0）。
 * 应用是 hash 路由，正文里的相对链接或 #锚点一变地址就会被路由当成页面路径，
 * 落到 catch-all 直接回今日页（「点链接跳主页」）。所以统一在这里接管：
 * - #锚点：在本页滚动到对应 id
 * - http(s) / mailto / tel：交给系统浏览器（与「检查更新→下载」同一条路径）
 * - 相对路径：本地文档没有可解析的基准，吞掉，别让它改掉 SPA 地址
 */
export function handleDocLink(
  e: { preventDefault: () => void },
  href: string | null | undefined,
): boolean {
  if (!href) return false
  e.preventDefault()
  // 应用内深链（如导出批注/引文生成的 #/docs/...）：交给 HashRouter 正常切换文档与锚点
  if (href.startsWith('#/')) {
    window.location.hash = href
    return true
  }
  if (href.startsWith('#')) {
    let id = href.slice(1)
    try { id = decodeURIComponent(id) } catch { /* 含非法 % 时按原文匹配 */ }
    // 标题没有 slug id（react-markdown 不会自动生成），按 GitHub 风格回退到标题文本匹配
    const el = document.getElementById(id) ?? headingBySlug(id)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return true
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    openExternal(href)
    return true
  }
  return true
}

/**
 * 外链交给系统浏览器。
 *
 * 安卓壳里不能用 `window.open(url, '_blank')`：WebView 没开多窗口、Capacitor 也没接
 * WebChromeClient.onCreateWindow，点了会**静默失败**（「检查更新→下载」、正文外链都是）。
 * 同窗导航会触发 shouldOverrideUrlLoading → Bridge.launchIntent，外部 host 被原生用
 * ACTION_VIEW 交给系统浏览器，WebView 自己不换页——所以走一次锚点跳转最稳。
 */
export function openExternal(url: string): void {
  if (!/^(https?:|mailto:|tel:)/i.test(url.trim())) return
  if (isTauri()) {
    // 桌面版：交给系统默认浏览器
    void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(url))
    return
  }
  if (isNative()) {
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function headingBySlug(slug: string): HTMLElement | null {
  const norm = (t: string) => t.trim().toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '')
  const heads = document.querySelectorAll<HTMLElement>('.md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6')
  for (const h of heads) if (norm(h.textContent ?? '') === slug) return h
  return null
}

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i

/**
 * react-markdown 默认的 URL 清洗会把 data: 全部去掉（图片 404 的根因）。
 * 这里改成白名单：http(s)/mailto/tel/安全位图 data:image 与相对地址放行，其它（含首空格/控制字符绕过、SVG、协议相对 //）清空。
 */
export function transformDocUrl(url: string): string {
  const cleaned = url.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  if (!cleaned || cleaned.startsWith('//')) return ''
  // hl: 是自写文档的高亮标记，wiki: 是文档库双链，交给 MdReader 自己渲染
  if (/^(https?:|mailto:|tel:|hl:|wiki:)/i.test(cleaned)) return cleaned
  if (SAFE_DATA_IMAGE.test(cleaned)) return cleaned
  if (!/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return cleaned
  return ''
}
