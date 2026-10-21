/**
 * HTML 白名单清洗：EPUB / DOCX 等外来文档里的 HTML 一律先过这里，
 * 再交给 dangerouslySetInnerHTML 渲染。
 *
 * 为什么必须做：EPUB 的 xhtml 与 mammoth 转出的 HTML 都来自外部文件，
 * 原样插进 DOM 等于把文档作者的脚本放进本站源执行——`<img src=x onerror=...>`
 * 这种一个属性就能跑。React 对 dangerouslySetInnerHTML 的要求也是调用方自己负责
 * 清洗（https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html）。
 *
 * 策略是「白名单」而不是「黑名单」：标签不在集合内就拆掉（危险容器整棵删掉），
 * 属性不在集合内就移除；URL 只放行 http/https/mailto/tel/blob/data:image。
 * 这里刻意不引第三方清洗库：规则要能一眼读完，也能在测试里逐条验证。
 */

/** 保留文本结构 + 图片 + 链接 + 表格；其余一律不认 */
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr', 'wbr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'em', 'i', 'strong', 'b', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'big', 'mark', 'code', 'kbd', 'samp', 'var', 'q', 'cite', 'abbr', 'dfn', 'time', 'ruby', 'rt', 'rp',
  'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'img', 'a',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
])

/** 连同内容整体删除：脚本、样式、框架、表单、多媒体、SVG（内联 SVG 可以带脚本与 foreignObject） */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'link', 'meta', 'base', 'title', 'head', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'param', 'form', 'input', 'button', 'select', 'option', 'textarea',
  'audio', 'video', 'source', 'track', 'canvas', 'noscript', 'template',
  'svg', 'math',
])

/** 所有标签都允许的属性（不含任何事件属性，on* 单独拦） */
const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'dir', 'lang', 'style', 'role'])

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'name', 'rel', 'target']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  td: new Set(['colspan', 'rowspan', 'align', 'valign', 'headers']),
  th: new Set(['colspan', 'rowspan', 'align', 'valign', 'scope', 'headers']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span', 'width']),
  ol: new Set(['start', 'type', 'reversed']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  ins: new Set(['cite', 'datetime']),
  del: new Set(['cite', 'datetime']),
}

/** 值必须过 URL 白名单的属性名 */
const URL_ATTRS = new Set(['href', 'src', 'cite', 'longdesc', 'poster', 'background'])

/** 行内样式只保留排版类属性；带 url()/expression() 的值一律丢掉（可用来回传数据或注入） */
const ALLOWED_STYLE_PROPS = new Set([
  'text-align', 'text-indent', 'text-transform', 'text-decoration', 'text-shadow',
  'font-weight', 'font-style', 'font-size', 'font-family', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius',
  'vertical-align', 'list-style-type', 'list-style-position', 'color', 'background-color',
  'width', 'height', 'max-width', 'min-width', 'opacity', 'display',
])

/** 允许的协议；相对地址（#、/、./、../、裸路径）单独判断 */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:', 'blob:']
const SAFE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i

/**
 * URL 是否安全。先去掉控制字符（`java\tscript:` 这类绕过），再看协议。
 * @param allowDataImage 是否放行 data:image/（正文内嵌图片用得到；链接不允许）
 */
export function isSafeUrl(raw: string, allowDataImage = true): boolean {
  // eslint-disable-next-line no-control-regex
  const url = raw.replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase()
  if (!url) return false
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true
  if (SAFE_DATA_URL.test(url)) return allowDataImage
  // 没有协议前缀 = 相对路径（a/b.html、chapter-1.xhtml）
  if (!/^[a-z][a-z0-9+.-]*:/.test(url)) return true
  return SAFE_PROTOCOLS.some((p) => url.startsWith(p))
}

function sanitizeStyle(value: string): string {
  const kept: string[] = []
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const val = decl.slice(i + 1).trim()
    if (!prop || !val) continue
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue
    const lower = val.toLowerCase()
    if (/url\(|expression\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding/.test(lower)) continue
    kept.push(`${prop}: ${val}`)
  }
  return kept.join('; ')
}

function cleanAttrs(el: Element): void {
  const tag = el.tagName.toLowerCase()
  const allowed = TAG_ATTRS[tag]
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    // 事件属性（onerror/onload/…）与 srcdoc 一律删：这是最省事也最要紧的一条
    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
      el.removeAttribute(attr.name)
      continue
    }
    if (!GLOBAL_ATTRS.has(name) && !allowed?.has(name)) {
      el.removeAttribute(attr.name)
      continue
    }
    if (name === 'style') {
      const css = sanitizeStyle(attr.value)
      if (css) el.setAttribute('style', css)
      else el.removeAttribute('style')
      continue
    }
    if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name)
    }
  }
  if (tag === 'a' && el.getAttribute('href')) {
    el.setAttribute('rel', 'noopener noreferrer nofollow')
  }
}

function sanitizeSubtree(root: Element): void {
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase()
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // 不在白名单但不是危险容器：拆壳保留内容（docx 里常见的 <o:p>、自定义标签）
      sanitizeSubtree(child)
      const parent = child.parentNode
      if (!parent) continue
      while (child.firstChild) parent.insertBefore(child.firstChild, child)
      child.remove()
      continue
    }
    cleanAttrs(child)
    sanitizeSubtree(child)
  }
}

/**
 * 清洗一段 HTML 片段，返回可直接交给 dangerouslySetInnerHTML 的字符串。
 * 需要在有 DOM 的环境里调用（浏览器 / jsdom）。
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  // DOMParser 解析出的文档是惰性的：不会执行脚本、不会发起图片请求，适合用来做清洗
  const doc = new DOMParser().parseFromString(html, 'text/html')
  sanitizeSubtree(doc.body)
  return doc.body.innerHTML
}
