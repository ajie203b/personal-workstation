import { Readability, isProbablyReaderable } from '@mozilla/readability'

/**
 * 网页正文解析管线（v3.3 文章离线）。
 *
 * 顺序固定：
 *   1. DOMParser 解析 → 插 `<base href=原URL>` 修正相对链接
 *   2. 站点适配器（hostname 匹配，Readability 之前跑）：挑正文根 / 去站点垃圾
 *   3. 懒加载图片提升（data-src 等 → src），删 noscript 重复副本，保留代码块语言标记
 *   4. 精确容器直出；否则 isProbablyReaderable → Readability → <article>/<main> 兜底
 *
 * 纯 DOM 逻辑，不碰网络；抓取在 netFetch，图片本地化在 articleImages。
 */

export type SiteKind =
  | 'wechat'
  | 'csdn'
  | 'juejin'
  | 'github'
  | 'cnblogs'
  | 'jianshu'
  | 'zhihu'
  | 'bilibili'
  | 'xiaohongshu'
  | 'generic'

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

/** 规范化文章 URL：缺协议的裸域名自动补 https://，拒绝非 http(s) 协议 */
export function normalizeArticleUrl(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  if (/\s/.test(v)) throw new Error('链接格式无效，请检查是否包含空格')
  if (/^https?:\/\//i.test(v)) {
    const parsed = new URL(v)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http:// 或 https:// 网页链接')
    }
    return parsed.href
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(?:javascript|data|vbscript|mailto|tel|file|ftp):/i.test(v)) {
    throw new Error('仅支持 http:// 或 https:// 网页链接')
  }
  let parsed: URL
  try {
    parsed = new URL(`https://${v}`)
  } catch {
    throw new Error('请输入有效的网页链接')
  }
  const host = parsed.hostname.toLowerCase()
  if (!host || (!host.includes('.') && host !== 'localhost' && !/^\[[\da-f:]+\]$/i.test(host))) {
    throw new Error('请输入有效的网页链接')
  }
  return parsed.href
}

/** src 是这些值时视为占位图，允许被懒加载属性覆盖 */
function isPlaceholderSrc(src: string): boolean {
  const s = src.trim()
  if (!s || s === 'about:blank' || s.startsWith('javascript:')) return true
  // 极短的 data: 图 = 1×1 透明 GIF / 占位小图；真的内嵌图 base64 不会这么小
  return /^data:image\/(gif|png|svg\+xml)/i.test(s) && s.length < 200
}

/** hostname / pathname → 站点类型（大小写不敏感，子域也算） */
export function siteKindOf(url: string): SiteKind {
  let host = url.trim().toLowerCase()
  let pathname = ''
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase()
    pathname = u.pathname.toLowerCase()
  } catch {
    /* 非法 URL 就拿整串当 host 匹配 */
  }
  if (host === 'mp.weixin.qq.com' || host.endsWith('.weixin.qq.com')) return 'wechat'
  if (host === 'blog.csdn.net' || host.endsWith('.csdn.net')) return 'csdn'
  if (host === 'juejin.cn' || host.endsWith('.juejin.cn') || host === 'juejin.im') return 'juejin'
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
  if (host === 'cnblogs.com' || host.endsWith('.cnblogs.com')) return 'cnblogs'
  if (host === 'jianshu.com' || host.endsWith('.jianshu.com')) return 'jianshu'
  if (host === 'zhihu.com' || host.endsWith('.zhihu.com')) return 'zhihu'
  if ((host === 'bilibili.com' || host.endsWith('.bilibili.com')) && /\/read\b/.test(pathname)) return 'bilibili'
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

function firstText(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const t = textOf(doc.querySelector(sel))
    if (t) return t
  }
  return undefined
}

function firstElement(doc: Document, selectors: string[]): Element | undefined {
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el) return el
  }
  return undefined
}

function removeJunk(doc: Document, selectors: string[]): void {
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach((el) => el.remove())
  }
}

function metaContent(doc: Document, key: string): string {
  // og:title / article:author 这类 property=，与 name=author 两种都认
  const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)
  return (el?.getAttribute('content') ?? '').trim()
}

/** 去掉站点拼在标题后面的尾巴（「xxx_微信公众号」「xxx - CSDN博客」「xxx - 掘金」等） */
export function cleanPageTitle(title: string): string {
  return (
    title
      .replace(
        /[_|·\-–—]\s*(微信公众号|CSDN博客|知乎日报|知乎|掘金|稀土掘金|博客园|简书|哔哩哔哩(?:_bilibili)?|GitHub)\s*$/i,
        '',
      )
      .trim() || title.trim()
  )
}

export interface SiteAdapterResult {
  site: SiteKind
  /** 适配器认定的正文根 */
  content?: Element
  /** 匹配到的正文容器是干净的站点正文块，可直接采用（跳过 Readability 误裁剪） */
  exact?: boolean
  title?: string
  byline?: string
}

/**
 * 站点适配器：Readability 之前跑，做两件事——
 * ① 移除站点特有的垃圾/遮罩（CSDN「展开阅读全文」、微信底部工具条、代码复制按钮等）；
 * ② 记录正文根，exact=true 时直接输出，否则供兜底。
 */
export function applySiteAdapter(doc: Document, url: string): SiteAdapterResult {
  const site = siteKindOf(url)

  if (site === 'wechat') {
    removeJunk(doc, ['#js_pc_qr_code', '.rich_media_tool', '#js_tags', '#js_article_bottom_ad', '#js_profile_qrcode'])
    const content = doc.querySelector('#js_content') ?? undefined
    return {
      site,
      content,
      exact: Boolean(content),
      title: textOf(doc.querySelector('#activity-name')) || metaContent(doc, 'og:title') || undefined,
      byline:
        textOf(doc.querySelector('#js_name')) ||
        textOf(doc.querySelector('#js_author_name')) ||
        metaContent(doc, 'og:article:author') ||
        undefined,
    }
  }

  if (site === 'csdn') {
    removeJunk(doc, ['.hide-article-box', '#treeSkill', '#blogColumnPayAdvert', '.recommend-box', '#articleBox', '.blog-footer-bottom', '.hljs-button'])
    const content = doc.querySelector('#content_views') ?? undefined
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['h1.title-article', '#articleContentId']),
      byline: textOf(doc.querySelector('.follow-nickName')) || metaContent(doc, 'author') || undefined,
    }
  }

  if (site === 'juejin') {
    removeJunk(doc, ['.copy-code-btn', '.code-block-extension-header', '.article-suspended-panel', '.recommended-area', '.comment-box'])
    const content = firstElement(doc, ['.article-viewer .markdown-body', '#article-root .markdown-body', '.markdown-body', '.article-content'])
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['h1.article-title', 'h1']) || metaContent(doc, 'og:title') || undefined,
      byline: firstText(doc, ['.author-name .name', '.username .name']) || metaContent(doc, 'author') || undefined,
    }
  }

  if (site === 'github') {
    removeJunk(doc, ['.anchor', '.octicon-link', 'clipboard-copy', '.zeroclipboard-container'])
    const content = firstElement(doc, ['#readme article.markdown-body', 'article.markdown-body', '.markdown-body'])
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['#readme h1', '.Box-header .Box-title', 'h1']) || metaContent(doc, 'og:title') || undefined,
      byline: metaContent(doc, 'octolytics-dimension-user_login') || firstText(doc, ['.author', '[rel="author"]']),
    }
  }

  if (site === 'cnblogs') {
    removeJunk(doc, ['#blog_post_info_block', '.postDesc', '#MySignature', '.cnblogs_code_toolbar'])
    const content = doc.querySelector('#cnblogs_post_body') ?? undefined
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['#cb_post_title_url', 'h1.postTitle', '.postTitle', 'h1']),
      byline: firstText(doc, ['#Header1_HeaderTitle', '.postDesc a']) || metaContent(doc, 'author') || undefined,
    }
  }

  if (site === 'jianshu') {
    removeJunk(doc, ['._3tCVn5', '._2Nttfz', '.show-foot', '.follow-detail', '.meta-bottom'])
    const content = firstElement(doc, ['article._2rhmJa', '._2rhmJa', '.show-content-free', 'article'])
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['h1._1RuRku', 'h1.title', 'h1']) || metaContent(doc, 'og:title') || undefined,
      byline: firstText(doc, ['span.Fx5GTc a', '.author .name a']) || metaContent(doc, 'author') || undefined,
    }
  }

  if (site === 'zhihu') {
    removeJunk(doc, ['.RichContent-collapsedText', '.ContentItem-actions', '.Post-Sub', '.ColumnPageHeader', '.Reward', '.Voters'])
    const content = firstElement(doc, ['.Post-RichTextContainer .RichText', '.Post-RichText'])
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['h1.Post-Title', 'h1.QuestionHeader-title']) || metaContent(doc, 'og:title') || undefined,
      byline: firstText(doc, ['.AuthorInfo-name .UserLink-link', '.AuthorInfo-name']) || metaContent(doc, 'author') || undefined,
    }
  }

  if (site === 'bilibili') {
    removeJunk(doc, ['.article-read-panel', '.interaction-info', '.opus-module-author', '.bili-comment'])
    const content = firstElement(doc, ['#read-article-holder', '.article-holder', '.opus-module-content'])
    return {
      site,
      content,
      exact: Boolean(content),
      title: firstText(doc, ['h1.title', '.opus-module-title', 'h1']) || metaContent(doc, 'og:title') || undefined,
      byline: firstText(doc, ['.up-name', '.author-name']) || metaContent(doc, 'author') || undefined,
    }
  }

  // 小红书登录墙多：不做结构假设，失败时给粘贴兜底提示
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

function extractLangFromEl(el: Element): string {
  const cls = el.getAttribute('class') ?? ''
  const clsMatch = /\b(?:language|lang)-([a-z0-9_+#.-]+)/i.exec(cls) ?? /\bbrush:\s*([a-z0-9_+#.-]+)/i.exec(cls)
  if (clsMatch) return clsMatch[1].toLowerCase()
  const attr = el.getAttribute('data-lang') || el.getAttribute('data-language') || el.getAttribute('lang')
  return attr ? attr.trim().toLowerCase().replace(/^language-/, '') : ''
}

/** Readability 会默认清洗 class：提前把代码块语言记到 data-lang，并列入 classesToPreserve */
function preserveCodeLanguages(doc: Document): string[] {
  const classes = new Set<string>()
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    const code = pre.querySelector('code')
    const lang = extractLangFromEl(code ?? pre) || extractLangFromEl(pre)
    if (!lang) continue
    const cls = `language-${lang}`
    classes.add(cls)
    const target = code ?? pre
    target.setAttribute('data-lang', lang)
    target.classList.add(cls)
  }
  return [...classes]
}

/** 还原 Readability/适配器产出的 `<pre><code>` 语言类名并清掉临时属性 */
function restoreCodeLanguages(html: string): string {
  if (!html || (!html.includes('data-lang') && !html.includes('<pre'))) return html
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const el of Array.from(parsed.body.querySelectorAll('pre, code'))) {
    const lang = extractLangFromEl(el)
    if (lang) {
      const target = el.tagName === 'PRE' ? el.querySelector('code') ?? el : el
      if (!target.classList.contains(`language-${lang}`)) target.classList.add(`language-${lang}`)
    }
    el.removeAttribute('data-lang')
    el.removeAttribute('data-language')
  }
  return parsed.body.innerHTML
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

/** 抽一段 HTML 的可见纯文本（先剔除 script/style/noscript 等非正文标签） */
export function extractVisibleText(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove())
  return doc.body?.textContent ?? ''
}

function countChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

/** 去除正文开头的重复主标题（Readability 常把原文 `<h1>` 转成 `<h2>` 留在正文最前） */
export function stripDuplicateLeadingHeading(root: Element, title: string): void {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const target = norm(title)
  if (!target) return

  let cursor: Element = root
  for (let depth = 0; depth < 4; depth++) {
    const meaningful = Array.from(cursor.childNodes).find(
      (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && Boolean(n.textContent?.trim())),
    )
    if (!meaningful || meaningful.nodeType !== Node.ELEMENT_NODE) return
    const el = meaningful as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'h1' || tag === 'h2') {
      if (norm(el.textContent ?? '') === target) el.remove()
      return
    }
    if (tag === 'div' || tag === 'article' || tag === 'section') {
      cursor = el
      continue
    }
    return
  }
}

function extractCleanContainerHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('script, style, nav, header, footer, aside, noscript').forEach((n) => n.remove())
  return clone.innerHTML
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
  const classesToPreserve = preserveCodeLanguages(doc)

  // Readability 之前的标题/作者（跑了之后 doc 里的原节点可能已被搬空）
  let title = adapter.title || metaContent(doc, 'og:title') || textOf(doc.querySelector('h1')) || cleanPageTitle(doc.title)
  let byline = adapter.byline || metaContent(doc, 'author') || metaContent(doc, 'og:article:author') || ''
  let siteName = metaContent(doc, 'og:site_name') || ''
  let contentHtml = ''
  let usedReadability = false

  // 精确站点正文容器（如微信公众号 #js_content / CSDN #content_views / 掘金等）直接采纳，不被 Readability 误裁
  if (adapter.exact && adapter.content) {
    const candidate = adapter.content.innerHTML
    if (countChars(extractVisibleText(candidate)) >= MIN_CHARS) {
      contentHtml = candidate
    }
  }

  if (!contentHtml) {
    // isProbablyReaderable 不碰文档，可安全探路；parse() 会改写文档，只能跑一次
    let readerable: boolean
    try {
      readerable = isProbablyReaderable(doc)
    } catch {
      readerable = false
    }

    if (readerable) {
      try {
        const parsed = new Readability(doc, { classesToPreserve }).parse()
        if (parsed?.content) {
          usedReadability = true
          contentHtml = parsed.content
          title = (parsed.title ?? '').trim() || title
          byline = (parsed.byline ?? '').trim() || byline
          siteName = (parsed.siteName ?? '').trim() || siteName
        }
      } catch {
        /* Readability 挂了就走适配器/语义容器兜底 */
      }
    }
  }

  if (!contentHtml && adapter.content) {
    contentHtml = adapter.content.innerHTML
  }

  // 短篇博文被 isProbablyReaderable 拒掉时，退回 <article> / <main> 语义容器
  if (!contentHtml) {
    const fallbackEl = doc.querySelector('article, main, [role="main"]')
    if (fallbackEl) contentHtml = extractCleanContainerHtml(fallbackEl)
  }

  contentHtml = restoreCodeLanguages(contentHtml)

  const textContent = extractVisibleText(contentHtml)
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
    preserveCodeLanguages(doc)
    const title = textOf(body.querySelector('h1, h2')) || firstLine(plain) || '粘贴的正文'
    const contentHtml = restoreCodeLanguages(body.innerHTML)
    const textContent = extractVisibleText(contentHtml)
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
