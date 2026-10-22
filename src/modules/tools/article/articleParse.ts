import { Readability, isProbablyReaderable } from '@mozilla/readability'

/**
 * 网页正文解析管线（v3.3 文章离线）。
 *
 * 顺序固定：
 *   1. DOMParser 解析 → 插 `<base href=原URL>` 修正相对链接
 *   2. 站点适配器（hostname 匹配，Readability 之前跑）：挑正文根 / 去站点垃圾
 *   3. 懒加载图片提升（data-src 等 → src），删 noscript 重复副本
 *   4. isProbablyReaderable 判定 → Readability 抽取；不像正文就用适配器结果 / 给粘贴兜底提示
 *
 * 纯 DOM 逻辑，不碰网络；抓取在 netFetch，图片本地化在 articleImages。
 */

export type SiteKind = 'wechat' | 'csdn' | 'zhihu' | 'xiaohongshu' | 'generic'

export interface ParsedArticle {
  title: string
  byline: string
  siteName: string
  /** 正文 HTML（相对链接已绝对化、懒加载图已提升） */
  contentHtml: string
  textContent: string
  /** 去空白字数 */
  charCount: number
  imageCount: number
  usedReadability: boolean
  site: SiteKind
  /** 提取失败（登录墙等）时给用户的兜底提示 */
  hint?: string
}

/** 登录墙 / 抽取失败统一话术（与产品文案一致） */
export const PASTE_FALLBACK_HINT = '正文提取失败（可能是登录墙）。请在原网页全选复制正文，粘贴到这里。'
export const LOGIN_WALL_HINT = '该站点需要登录才能查看全文。请在原网页全选复制正文，粘贴到这里。'

const LOGIN_WALL_SITES: SiteKind[] = ['zhihu', 'xiaohongshu']

/** 懒加载常见的真图属性，按优先级取 */
const LAZY_ATTRS = ['data-src', 'data-original', 'data-actualsrc', 'data-lazy-src', 'data-echo']

/** src 是这些值时视为占位图，允许被懒加载属性覆盖 */
function isPlaceholderSrc(src: string): boolean {
  const s = src.trim()
  if (!s || s === 'about:blank' || s.startsWith('javascript:')) return true
  // 极短的 data: 图 = 1×1 透明 GIF / 占位小图；真的内嵌图 base64 不会这么小
  return /^data:image\/(gif|png|svg\+xml)/i.test(s) && s.length < 200
}

/** hostname → 站点类型（大小写不敏感，子域也算） */
export function siteKindOf(url: string): SiteKind {
  let host = url.trim().toLowerCase()
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    /* 非法 URL 就拿整串当 host 匹配 */
  }
  if (host === 'mp.weixin.qq.com' || host.endsWith('.weixin.qq.com')) return 'wechat'
  if (host === 'blog.csdn.net' || host.endsWith('.csdn.net')) return 'csdn'
  if (host === 'zhihu.com' || host.endsWith('.zhihu.com')) return 'zhihu'
  if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) return 'xiaohongshu'
  return 'generic'
}

/** 解析 HTML 并在 head 顶部插入 `<base href>`，后续相对链接解析都以原 URL 为基准 */
export function parseDocument(html: string, url: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const base = doc.createElement('base')
  base.setAttribute('href', url)
  const head = doc.head ?? doc.getElementsByTagName('head')[0]
  if (head) head.insertBefore(base, head.firstChild)
  return doc
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim()
}

function metaContent(doc: Document, key: string): string {
  // og:title / article:author 这类 property=，与 name=author 两种都认
  const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)
  return (el?.getAttribute('content') ?? '').trim()
}

/** 去掉站点拼在标题后面的尾巴（「xxx_微信公众号」「xxx - CSDN博客」） */
export function cleanPageTitle(title: string): string {
  return title.replace(/[_|·\-–—]\s*(微信公众号|CSDN博客|知乎日报|小红书)\s*$/i, '').trim() || title.trim()
}

export interface SiteAdapterResult {
  site: SiteKind
  /** 适配器认定的正文根（Readability 不可用时的兜底） */
  content?: Element
  title?: string
  byline?: string
}

/**
 * 站点适配器：Readability 之前跑，做两件事——
 * ① 移除站点特有的垃圾/遮罩（CSDN「展开阅读全文」、微信底部工具条）；
 * ② 记录正文根，供「不像正文」时兜底。
 */
export function applySiteAdapter(doc: Document, url: string): SiteAdapterResult {
  const site = siteKindOf(url)

  if (site === 'wechat') {
    // 微信正文固定在 #js_content；工具条 / 二维码 / 底部广告不在正文里
    for (const sel of ['#js_pc_qr_code', '.rich_media_tool', '#js_tags', '#js_article_bottom_ad', '#js_profile_qrcode']) {
      doc.querySelectorAll(sel).forEach((el) => el.remove())
    }
    return {
      site,
      content: doc.querySelector('#js_content') ?? undefined,
      title: textOf(doc.querySelector('#activity-name')) || metaContent(doc, 'og:title') || undefined,
      byline:
        textOf(doc.querySelector('#js_name')) ||
        textOf(doc.querySelector('#js_author_name')) ||
        metaContent(doc, 'og:article:author') ||
        undefined,
    }
  }

  if (site === 'csdn') {
    // 「展开阅读全文」遮罩 + 目录/专栏/推荐位；正文固定在 #content_views
    for (const sel of ['.hide-article-box', '#treeSkill', '#blogColumnPayAdvert', '.recommend-box', '#articleBox', '.blog-footer-bottom']) {
      doc.querySelectorAll(sel).forEach((el) => el.remove())
    }
    return {
      site,
      content: doc.querySelector('#content_views') ?? undefined,
      title: textOf(doc.querySelector('h1.title-article')) || textOf(doc.querySelector('#articleContentId')) || undefined,
      byline: textOf(doc.querySelector('.follow-nickName')) || metaContent(doc, 'author') || undefined,
    }
  }

  // 知乎 / 小红书登录墙多：不做结构假设，失败时给粘贴兜底提示
  return { site }
}

/**
 * 懒加载图片提升：data-src / data-original / data-actualsrc → src，
 * 再把 noscript 里的重复副本去掉（外面已有同 src 的真图就整块删，
 * 否则展开它的内容，避免唯一一份图被连锅端）。
 */
export function promoteLazyImages(root: Document | Element): number {
  let promoted = 0
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const cur = img.getAttribute('src') ?? ''
    if (!isPlaceholderSrc(cur)) continue
    for (const attr of LAZY_ATTRS) {
      const v = (img.getAttribute(attr) ?? '').trim()
      if (v) {
        img.setAttribute('src', v)
        promoted++
        break
      }
    }
    // src 已定，懒加载属性是冗余信息，一并清掉（否则会漏进导出的正文）
    for (const attr of LAZY_ATTRS) img.removeAttribute(attr)
  }

  // noscript 重复副本清理
  for (const ns of Array.from(root.querySelectorAll('noscript'))) {
    const innerImgs = Array.from(ns.querySelectorAll('img'))
    if (!innerImgs.length) {
      ns.remove()
      continue
    }
    const outerSrcs = new Set(
      Array.from(root.querySelectorAll('img'))
        .filter((img) => !ns.contains(img))
        .map((img) => img.getAttribute('src') ?? ''),
    )
    const duplicated = innerImgs.every((img) => outerSrcs.has(img.getAttribute('src') ?? ''))
    if (duplicated) {
      ns.remove()
    } else {
      // 这份图只存在于 noscript 里：展开保图（降级为普通元素后再提升一次）
      while (ns.firstChild) ns.parentNode?.insertBefore(ns.firstChild, ns)
      ns.remove()
    }
  }
  return promoted
}

/** 相对链接 → 绝对链接（Readability 只管自己的内容，适配器路径要自己修） */
export function absolutizeUris(root: Element, baseUrl: string): void {
  for (const el of Array.from(root.querySelectorAll('a[href], img[src]'))) {
    for (const attr of ['href', 'src']) {
      const raw = (el.getAttribute(attr) ?? '').trim()
      if (!raw || raw.startsWith('#') || raw.startsWith('data:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue
      try {
        el.setAttribute(attr, new URL(raw, baseUrl).href)
      } catch {
        /* 非法 URL 保留原样 */
      }
    }
  }
}

/** 一段 HTML 里的图片数 */
export function htmlImageCount(html: string): number {
  if (!html) return 0
  return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img').length
}

function countChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

/** 去空白后的正文长度至少要像篇文章，太短视为提取失败 */
const MIN_CHARS = 20

/**
 * 完整解析：抓回来的 HTML + 原 URL → 标题/作者/正文/字数/图片数。
 * Readability 会改写传入的文档，标题等元信息在它跑之前先取好。
 */
export function extractArticle(html: string, url: string): ParsedArticle {
  const doc = parseDocument(html, url)
  const adapter = applySiteAdapter(doc, url)
  promoteLazyImages(doc)
  const body = doc.body ?? doc.documentElement
  absolutizeUris(body, url)

  // Readability 之前的标题/作者（跑了之后 doc 里的原节点可能已被搬空）
  let title = adapter.title || metaContent(doc, 'og:title') || textOf(doc.querySelector('h1')) || cleanPageTitle(doc.title)
  let byline = adapter.byline || metaContent(doc, 'author') || metaContent(doc, 'og:article:author') || ''
  let siteName = metaContent(doc, 'og:site_name') || ''
  let contentHtml = ''
  let usedReadability = false

  // isProbablyReaderable 不碰文档，可安全探路；parse() 会改写文档，只能跑一次
  let readerable = false
  try {
    readerable = isProbablyReaderable(doc)
  } catch {
    readerable = false
  }

  if (readerable) {
    try {
      const parsed = new Readability(doc).parse()
      if (parsed?.content) {
        usedReadability = true
        contentHtml = parsed.content
        title = (parsed.title ?? '').trim() || title
        byline = (parsed.byline ?? '').trim() || byline
        siteName = (parsed.siteName ?? '').trim() || siteName
      }
    } catch {
      /* Readability 挂了就走适配器兜底 */
    }
  }

  if (!contentHtml && adapter.content) {
    contentHtml = adapter.content.innerHTML
  }

  const textContent = contentHtml
    ? new DOMParser().parseFromString(contentHtml, 'text/html').body?.textContent ?? ''
    : ''
  const charCount = countChars(textContent)

  if (charCount < MIN_CHARS) {
    return {
      title,
      byline,
      siteName,
      contentHtml: '',
      textContent: '',
      charCount: 0,
      imageCount: 0,
      usedReadability,
      site: adapter.site,
      hint: LOGIN_WALL_SITES.includes(adapter.site) ? LOGIN_WALL_HINT : PASTE_FALLBACK_HINT,
    }
  }

  return {
    title: cleanPageTitle(title) || '无标题文章',
    byline,
    siteName,
    contentHtml,
    textContent: textContent.trim(),
    charCount,
    imageCount: htmlImageCount(contentHtml),
    usedReadability,
    site: adapter.site,
  }
}

/**
 * 粘贴兜底：解析剪贴板的 text/html（全选复制带样式）或纯文本。
 * 用户已经手工圈过正文，不再跑 Readability，直接取 body / 分段。
 */
export function extractPastedContent(html: string | null | undefined, text: string, url = ''): ParsedArticle {
  const plain = (text ?? '').trim()
  if (html && html.trim()) {
    const doc = parseDocument(html, url || 'https://pasted.invalid/')
    promoteLazyImages(doc)
    const body = doc.body
    absolutizeUris(body, url || 'https://pasted.invalid/')
    const title = textOf(body.querySelector('h1, h2')) || firstLine(plain) || '粘贴的正文'
    const contentHtml = body.innerHTML
    const textContent = body.textContent ?? ''
    return {
      title: cleanPageTitle(title),
      byline: metaContent(doc, 'author') || metaContent(doc, 'og:article:author') || '',
      siteName: metaContent(doc, 'og:site_name') || '',
      contentHtml,
      textContent: textContent.trim(),
      charCount: countChars(textContent),
      imageCount: htmlImageCount(contentHtml),
      usedReadability: false,
      site: url ? siteKindOf(url) : 'generic',
    }
  }

  // 纯文本：空行分段包 <p>（用 DOM 造节点，不拼用户字符串进 HTML）
  const paras = plain.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  const shell = new DOMParser().parseFromString('<div></div>', 'text/html')
  const wrap = shell.body.firstElementChild as Element
  for (const seg of paras) {
    const p = shell.createElement('p')
    p.textContent = seg
    wrap.appendChild(p)
  }
  const contentHtml = wrap.innerHTML
  return {
    title: firstLine(plain) || '粘贴的正文',
    byline: '',
    siteName: '',
    contentHtml,
    textContent: plain,
    charCount: countChars(plain),
    imageCount: 0,
    usedReadability: false,
    site: url ? siteKindOf(url) : 'generic',
  }
}

function firstLine(text: string): string {
  return (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 80)
}
