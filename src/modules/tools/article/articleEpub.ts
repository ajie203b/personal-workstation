import { formatCapturedAt } from './articleMarkdown'

/**
 * 单篇文章 → EPUB 3（v3.3 文章离线）。结构对齐 lib/fanqieExport.ts 的 buildFanqieEpub：
 *
 * - `mimetype` 必须是 zip 第一个条目且 STORE 不压缩（阅读器校验这条）
 * - META-INF/container.xml → OEBPS/content.opf；导航 OEBPS/nav.xhtml（+ toc.ncx 兼容旧阅读器）
 * - 正文不用字符串拼接：DOM 里搭好 XHTML 骨架，正文节点 import 进去后交给
 *   XMLSerializer 序列化——转义与空元素闭合都由序列化器保证合法
 * - 图片 dataURL 解码后落 OEBPS/images/，src 改成相对路径并进 manifest
 */

export interface ArticleEpubInput {
  title: string
  byline?: string
  sourceUrl?: string
  /** 抓取时间（毫秒时间戳） */
  capturedAt: number
  /** 正文 HTML（图片已本地化为 dataURL 的优先；外链图保留原地址） */
  contentHtml: string
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** dataURL → 字节 + MIME（不是 dataURL 或解不动返回 null） */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl ?? '')
  if (!m) return null
  const mime = m[1].toLowerCase()
  try {
    if (m[2]) {
      const bin = atob(m[3].replace(/\s+/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { bytes, mime }
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime }
  } catch {
    return null
  }
}

function extOf(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  }
  return map[mime] ?? 'img'
}

/**
 * 搭一个 XHTML 文档骨架（application/xhtml+xml 解析出来的 DOM 才能序列化成合法 XML）。
 * title / 来源行 / 正文节点都用 DOM API 放进去，用户内容一律走 textContent 自动转义。
 */
function buildChapterXhtml(input: ArticleEpubInput, bodyNodes: Node[]): string {
  const xhtml = new DOMParser().parseFromString(
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">'
      + '<head><meta charset="utf-8" /><title></title>'
      + '<link rel="stylesheet" type="text/css" href="style.css" /></head><body></body></html>',
    'application/xhtml+xml',
  )
  if (xhtml.querySelector('parsererror')) throw new Error('XHTML 模板解析失败')

  const title = input.title.trim() || '无标题文章'
  const headTitle = xhtml.querySelector('title')
  if (headTitle) headTitle.textContent = title

  const body = xhtml.querySelector('body')
  if (!body) throw new Error('XHTML 模板缺 body')

  const h1 = xhtml.createElementNS(XHTML_NS, 'h1')
  h1.textContent = title
  body.appendChild(h1)

  if (input.sourceUrl || input.byline) {
    const meta = xhtml.createElementNS(XHTML_NS, 'p')
    meta.setAttribute('class', 'meta')
    if (input.byline) {
      meta.appendChild(xhtml.createTextNode(`作者:${input.byline}　`))
    }
    if (input.sourceUrl) {
      meta.appendChild(xhtml.createTextNode('来源:'))
      const a = xhtml.createElementNS(XHTML_NS, 'a')
      a.setAttribute('href', input.sourceUrl)
      a.textContent = input.sourceUrl
      meta.appendChild(a)
      meta.appendChild(xhtml.createTextNode(`　抓取时间:${formatCapturedAt(input.capturedAt)}`))
    } else {
      meta.appendChild(xhtml.createTextNode(`抓取时间:${formatCapturedAt(input.capturedAt)}`))
    }
    body.appendChild(meta)
  }

  const hr = xhtml.createElementNS(XHTML_NS, 'hr')
  body.appendChild(hr)

  for (const node of bodyNodes) body.appendChild(xhtml.importNode(node, true))

  // XMLSerializer 负责转义与自闭合；只把固定的 XML 声明/DOCTYPE 拼在最前
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n${new XMLSerializer().serializeToString(xhtml.documentElement)}`
}

export async function buildArticleEpub(input: ArticleEpubInput): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  // 第一个条目且 STORE：EPUB 规范硬要求
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  )

  // 正文片段进 HTML 沙盒文档（innerHTML 解析宽容），图片落地后再把节点搬进 XHTML
  const scratch = new DOMParser().parseFromString('<html><body></body></html>', 'text/html')
  const scratchBody = scratch.body
  scratchBody.innerHTML = input.contentHtml || ''

  interface ManifestImage {
    id: string
    href: string
    mime: string
  }
  const images: ManifestImage[] = []
  let imgIndex = 0
  for (const img of Array.from(scratchBody.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    const data = dataUrlToBytes(src)
    if (!data) continue // 外链图：保留原地址，阅读器联网才显示
    imgIndex++
    const href = `images/img-${imgIndex}.${extOf(data.mime)}`
    zip.file(`OEBPS/${href}`, data.bytes)
    images.push({ id: `img-${imgIndex}`, href, mime: data.mime })
    img.setAttribute('src', href)
    img.removeAttribute('srcset')
  }

  zip.file('OEBPS/article.xhtml', buildChapterXhtml(input, Array.from(scratchBody.childNodes)))

  zip.file(
    'OEBPS/style.css',
    `body { font-family: "Noto Serif SC", "Songti SC", serif; line-height: 1.85; margin: 1.2em; }
h1 { font-size: 1.5em; line-height: 1.5; margin: 0 0 0.6em; }
.meta { color: #666; font-size: 0.85em; }
p { margin: 0.75em 0; }
img { max-width: 100%; height: auto; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #ddd; color: #444; }`,
  )

  const title = input.title.trim() || '无标题文章'
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      <li><a href="article.xhtml">${escapeXml(title)}</a></li>
    </ol>
  </nav>
</body>
</html>`,
  )

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:article:${escapeXml(String(input.capturedAt))}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>${escapeXml(title)}</text></navLabel>
      <content src="article.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
  )

  const manifestImages = images
    .map((im) => `    <item id="${im.id}" href="${im.href}" media-type="${im.mime}"/>`)
    .join('\n')
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const creator = input.byline ? `    <dc:creator>${escapeXml(input.byline)}</dc:creator>\n` : ''
  const source = input.sourceUrl ? `    <dc:source>${escapeXml(input.sourceUrl)}</dc:source>\n` : ''

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:article:${escapeXml(String(input.capturedAt))}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
${creator}${source}    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>
${manifestImages}
  </manifest>
  <spine toc="ncx">
    <itemref idref="article"/>
  </spine>
</package>`,
  )

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}
