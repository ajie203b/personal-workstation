import type { FanqieBook, FanqieChapterRow } from '@/db/db'
import { formatDate, formatWordCount } from './fanqie'

/** Windows/安卓文件系统不接受的字符换成全角，尽量保住书名原样 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, (c) => {
      const map: Record<string, string> = { '<': '＜', '>': '＞', ':': '：', '"': '＂', '/': '／', '\\': '＼', '|': '｜', '?': '？', '*': '＊' }
      return map[c] ?? ''
    })
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return (cleaned || '番茄小说').slice(0, 80)
}

function sortChapters(chapters: FanqieChapterRow[]): FanqieChapterRow[] {
  return [...chapters].sort((a, b) => a.index - b.index)
}

function txtHeader(book: FanqieBook, count: number): string {
  const lines = [`《${book.title}》`, `作者：${book.author}`, `状态：${book.status || '未知'}`]
  const words = formatWordCount(book.wordCount)
  if (words) lines.push(`字数：${words}`)
  lines.push(`已收录：${count} / ${book.chapterCount} 章`)
  const updated = formatDate(book.updatedAt)
  if (updated) lines.push(`官网更新：${updated}`)
  if (book.abstract) lines.push('', '简介：', book.abstract)
  lines.push('', '—'.repeat(18), '')
  return lines.join('\n')
}

/** TXT：带 BOM，Windows 记事本 / 安卓阅读器都不会乱码 */
export function buildFanqieTxt(book: FanqieBook, chapters: FanqieChapterRow[]): Blob {
  const rows = sortChapters(chapters)
  const parts: string[] = [txtHeader(book, rows.length)]
  let volume = ''
  for (const ch of rows) {
    if (ch.volume && ch.volume !== volume) {
      volume = ch.volume
      parts.push(`\n【${volume}】\n`)
    }
    parts.push(`\n${ch.title}\n\n${ch.content}\n`)
  }
  return new Blob(['\ufeff' + parts.join('\n')], { type: 'text/plain;charset=utf-8' })
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paragraphs(content: string): string {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join('\n')
}

function chapterXhtml(title: string, content: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${paragraphs(content)}
</body>
</html>`
}

/** EPUB 3（带 NCX 兼容旧阅读器）；封面用生成的文字页，不依赖外链图片 */
export async function buildFanqieEpub(book: FanqieBook, chapters: FanqieChapterRow[]): Promise<Blob> {
  const rows = sortChapters(chapters)
  if (!rows.length) throw new Error('还没有下载任何章节')
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

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

  const files = rows.map((ch, i) => {
    const name = `chapter-${String(i + 1).padStart(4, '0')}.xhtml`
    zip.file(`OEBPS/${name}`, chapterXhtml(ch.title, ch.content))
    return { ch, name, id: `c${String(i + 1).padStart(4, '0')}` }
  })

  zip.file(
    'OEBPS/style.css',
    `body { font-family: "Noto Serif SC", "Songti SC", serif; line-height: 1.85; margin: 1.2em; }
h1 { font-size: 1.4em; line-height: 1.5; margin: 1em 0 1.2em; }
p { margin: 0.75em 0; text-indent: 2em; }
.cover { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 80vh; text-align: center; }
.cover h1 { font-size: 2em; text-indent: 0; }
.cover p { text-indent: 0; color: #666; }`,
  )

  zip.file(
    'OEBPS/cover.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>封面</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="cover"><h1>${escapeXml(book.title)}</h1><p>${escapeXml(book.author)}</p></div></body>
</html>`,
  )

  const navItems = files
    .map(({ ch, name }) => `      <li><a href="${name}">${escapeXml(ch.title)}</a></li>`)
    .join('\n')
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
${navItems}
    </ol>
  </nav>
</body>
</html>`,
  )

  const navPoints = files
    .map(
      ({ ch, name }, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="${name}"/>
    </navPoint>`,
    )
    .join('\n')
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:fanqie:${escapeXml(book.id)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`,
  )

  const manifestChapters = files
    .map(({ name, id }) => `    <item id="${id}" href="${name}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spine = files.map(({ id }) => `    <itemref idref="${id}"/>`).join('\n')
  const subjects = book.tags.map((t) => `    <dc:subject>${escapeXml(t)}</dc:subject>`).join('\n')
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:fanqie:${escapeXml(book.id)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:description>${escapeXml(book.abstract)}</dc:description>
    <dc:source>https://fanqienovel.com/page/${escapeXml(book.id)}</dc:source>
${subjects}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
${manifestChapters}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
${spine}
  </spine>
</package>`,
  )

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}

/** 浏览器 / WebView 里的另存为 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 导入文档工作站阅读（EPUB 去重由 importDoc 的 hash 负责） */
export async function importFanqieToDocs(book: FanqieBook, chapters: FanqieChapterRow[]): Promise<string> {
  const blob = await buildFanqieEpub(book, chapters)
  const file = new File([blob], `${sanitizeFilename(book.title)}.epub`, { type: 'application/epub+zip' })
  const { importDoc } = await import('@/db/docs')
  const result = await importDoc(file)
  return result.doc.id
}
