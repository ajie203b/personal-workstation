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
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1))
    // 标题没有 slug id（react-markdown 不会自动生成），按 GitHub 风格回退到标题文本匹配
    const el = document.getElementById(id) ?? headingBySlug(id)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return true
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    window.open(href, '_blank')
    return true
  }
  return true
}

function headingBySlug(slug: string): HTMLElement | null {
  const norm = (t: string) => t.trim().toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '')
  const heads = document.querySelectorAll<HTMLElement>('.md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6')
  for (const h of heads) if (norm(h.textContent ?? '') === slug) return h
  return null
}

/**
 * react-markdown 默认的 URL 清洗会把 data: 全部去掉（图片 404 的根因）。
 * 这里改成白名单：http(s)/mailto/tel/data:image 与相对地址放行，其它（javascript: 等）清空。
 */
export function transformDocUrl(url: string): string {
  // hl: 是自写文档的高亮标记，交给 MdReader 自己渲染
  if (/^(https?:|mailto:|tel:|data:image\/|hl:)/i.test(url)) return url
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  return ''
}
