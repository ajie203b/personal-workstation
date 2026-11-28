import type { FanqieBook, FanqieChapterRow } from '@/db/db'
import { formatDate, formatWordCount } from './fanqie'
import { httpBytes } from './http'

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

/** 剔除 XML 1.0 非法控制字符后再做实体转义 */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
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

function xhtmlDoc(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`
}

interface CoverImageAsset {
  filename: string
  mediaType: string
  bytes: ArrayBuffer
}

function detectImageFormat(bytes: ArrayBuffer, contentType: string): { ext: string; mediaType: string } | null {
  const head = new Uint8Array(bytes.slice(0, 16))
  if (head.length < 4) return null
  if (head[0] === 0xff && head[1] === 0xd8) return { ext: 'jpg', mediaType: 'image/jpeg' }
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { ext: 'png', mediaType: 'image/png' }
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return { ext: 'webp', mediaType: 'image/webp' }
  }
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return { ext: 'gif', mediaType: 'image/gif' }
  if (contentType.startsWith('image/')) {
    const clean = contentType.split(';')[0].trim().toLowerCase()
    const ext = clean === 'image/png' ? 'png' : clean === 'image/webp' ? 'webp' : clean === 'image/gif' ? 'gif' : 'jpg'
    return { ext, mediaType: clean }
  }
  return null
}

async function fetchCoverAsset(coverUrl?: string): Promise<CoverImageAsset | null> {
  if (!coverUrl) return null
  const url = coverUrl.replace(/^http:\/\//i, 'https://')
  try {
    const { bytes, contentType } = await httpBytes(url, { timeoutMs: 6_000, proxyFallback: true })
    const fmt = detectImageFormat(bytes, contentType)
    if (!fmt) return null
    return {
      filename: `cover.${fmt.ext}`,
      mediaType: fmt.mediaType,
      bytes,
    }
  } catch {
    return null
  }
}

function buildIntroXhtml(book: FanqieBook, downloadedCount: number): string {
  const words = formatWordCount(book.wordCount)
  const updated = formatDate(book.updatedAt)
  const metaLines = [
    `<p><strong>书名：</strong>${escapeXml(book.title)}</p>`,
    `<p><strong>作者：</strong>${escapeXml(book.author || '佚名')}</p>`,
    book.status ? `<p><strong>状态：</strong>${escapeXml(book.status)}</p>` : '',
    words ? `<p><strong>字数：</strong>${escapeXml(words)}</p>` : '',
    `<p><strong>章节：</strong>已收录 ${downloadedCount} / ${book.chapterCount || downloadedCount} 章</p>`,
    updated ? `<p><strong>更新：</strong>${escapeXml(updated)}</p>` : '',
    book.tags.length ? `<p><strong>标签：</strong>${escapeXml(book.tags.join(' · '))}</p>` : '',
  ].filter(Boolean)
  const abstractBody = book.abstract
    ? `  <h2>简介正文</h2>\n  ${paragraphs(book.abstract)}`
    : ''
  return xhtmlDoc(
    `书籍简介 - ${book.title}`,
    `  <div class="intro">
    <h1>书籍简介</h1>
    <div class="intro-meta">
      ${metaLines.join('\n      ')}
    </div>
${abstractBody}
  </div>`,
  )
}

export interface BuildEpubOptions {
  /** 是否尝试抓取并内嵌封面图（默认 true） */
  embedCover?: boolean
  /** 存在分卷时是否生成分卷扉页（默认 true） */
  volumePages?: boolean
}

interface ChapterEntry {
  ch: FanqieChapterRow
  name: string
  id: string
}

interface VolumeGroup {
  volume?: string
  pageName?: string
  pageId?: string
  chapters: ChapterEntry[]
}

/** EPUB 3（带 NCX 兼容旧阅读器）：保留分卷层级、书籍简介页并尽力内嵌封面图 */
export async function buildFanqieEpub(
  book: FanqieBook,
  chapters: FanqieChapterRow[],
  options?: BuildEpubOptions,
): Promise<Blob> {
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

  const coverImage = options?.embedCover === false ? null : await fetchCoverAsset(book.cover)
  if (coverImage) {
    zip.file(`OEBPS/${coverImage.filename}`, coverImage.bytes)
  }

  const chapterFiles: ChapterEntry[] = rows.map((ch, i) => {
    const name = `chapter-${String(i + 1).padStart(4, '0')}.xhtml`
    zip.file(`OEBPS/${name}`, xhtmlDoc(ch.title, `  <h1>${escapeXml(ch.title)}</h1>\n  ${paragraphs(ch.content)}`))
    return { ch, name, id: `c${String(i + 1).padStart(4, '0')}` }
  })

  // 按连续同卷名分组，保留分卷层级
  const groups: VolumeGroup[] = []
  for (const entry of chapterFiles) {
    const vol = entry.ch.volume?.trim() || undefined
    const last = groups[groups.length - 1]
    if (!last || last.volume !== vol) {
      groups.push({ volume: vol, chapters: [entry] })
    } else {
      last.chapters.push(entry)
    }
  }
  const hasVolumes = groups.some((g) => Boolean(g.volume))
  const includeVolumePages = hasVolumes && options?.volumePages !== false

  const volumeFiles: { id: string; name: string }[] = []
  if (includeVolumePages) {
    let volIndex = 0
    for (const g of groups) {
      if (!g.volume) continue
      volIndex++
      const name = `volume-${String(volIndex).padStart(4, '0')}.xhtml`
      const id = `v${String(volIndex).padStart(4, '0')}`
      g.pageName = name
      g.pageId = id
      volumeFiles.push({ id, name })
      const firstTitle = g.chapters[0]?.ch.title ?? ''
      const lastTitle = g.chapters[g.chapters.length - 1]?.ch.title ?? ''
      const sub = g.chapters.length > 1
        ? `共 ${g.chapters.length} 章 · ${firstTitle} — ${lastTitle}`
        : `共 ${g.chapters.length} 章 · ${firstTitle}`
      zip.file(
        `OEBPS/${name}`,
        xhtmlDoc(
          g.volume,
          `  <div class="volume-page">\n    <h1>${escapeXml(g.volume)}</h1>\n    <p>${escapeXml(sub)}</p>\n  </div>`,
        ),
      )
    }
  }

  zip.file(
    'OEBPS/style.css',
    `body { font-family: "Noto Serif SC", "Songti SC", serif; line-height: 1.85; margin: 1.2em; }
h1 { font-size: 1.4em; line-height: 1.5; margin: 1em 0 1.2em; }
h2 { font-size: 1.15em; line-height: 1.5; margin: 1.2em 0 0.6em; }
p { margin: 0.75em 0; text-indent: 2em; }
.cover { text-align: center; padding: 2.5em 1em 2em; page-break-after: always; break-after: page; }
.cover-image { max-width: 72%; max-height: 24em; height: auto; margin: 0 auto 1.4em; display: block; }
.cover h1 { font-size: 1.9em; text-indent: 0; margin: 0.4em 0; }
.cover p { text-indent: 0; color: #666; margin: 0.3em 0; }
.intro { page-break-after: always; break-after: page; }
.intro-meta { margin: 1em 0 1.4em; padding: 0.75em 1em; border-left: 3px solid #cccccc; }
.intro-meta p { text-indent: 0; margin: 0.25em 0; font-size: 0.92em; color: #555555; }
.volume-page { text-align: center; padding: 4em 1em 2em; page-break-after: always; break-after: page; }
.volume-page h1 { font-size: 1.55em; margin: 0 0 0.6em; text-indent: 0; }
.volume-page p { text-indent: 0; color: #666666; font-size: 0.92em; }`,
  )

  const coverBody = coverImage
    ? `  <div class="cover">\n    <img class="cover-image" src="${coverImage.filename}" alt="${escapeXml(book.title)}"/>\n    <h1>${escapeXml(book.title)}</h1>\n    <p>${escapeXml(book.author)}</p>\n  </div>`
    : `  <div class="cover">\n    <h1>${escapeXml(book.title)}</h1>\n    <p>${escapeXml(book.author)}</p>\n  </div>`
  zip.file('OEBPS/cover.xhtml', xhtmlDoc('封面', coverBody))
  zip.file('OEBPS/intro.xhtml', buildIntroXhtml(book, rows.length))

  // nav.xhtml（支持嵌套分卷 <ol>）
  const navEntries: string[] = [
    '      <li><a href="cover.xhtml">封面</a></li>',
    '      <li><a href="intro.xhtml">书籍简介</a></li>',
  ]
  for (const g of groups) {
    if (g.volume) {
      const volHeading = g.pageName
        ? `<a href="${g.pageName}">${escapeXml(g.volume)}</a>`
        : `<span>${escapeXml(g.volume)}</span>`
      const children = g.chapters
        .map(({ ch, name }) => `          <li><a href="${name}">${escapeXml(ch.title)}</a></li>`)
        .join('\n')
      navEntries.push(`      <li>\n        ${volHeading}\n        <ol>\n${children}\n        </ol>\n      </li>`)
    } else {
      for (const { ch, name } of g.chapters) {
        navEntries.push(`      <li><a href="${name}">${escapeXml(ch.title)}</a></li>`)
      }
    }
  }
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
${navEntries.join('\n')}
    </ol>
  </nav>
</body>
</html>`,
  )

  // toc.ncx（存在分卷时 depth=2 并嵌套 navPoint）
  let playOrder = 1
  const ncxNodes: string[] = [
    `    <navPoint id="np-intro" playOrder="${playOrder++}">
      <navLabel><text>书籍简介</text></navLabel>
      <content src="intro.xhtml"/>
    </navPoint>`,
  ]
  let volCounter = 0
  let chCounter = 0
  for (const g of groups) {
    if (g.volume) {
      volCounter++
      const volOrder = playOrder++
      const volSrc = g.pageName ?? g.chapters[0].name
      const childPoints = g.chapters
        .map(({ ch, name }) => {
          chCounter++
          return `      <navPoint id="np${chCounter}" playOrder="${playOrder++}">
        <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
        <content src="${name}"/>
      </navPoint>`
        })
        .join('\n')
      ncxNodes.push(`    <navPoint id="np-vol-${volCounter}" playOrder="${volOrder}">
      <navLabel><text>${escapeXml(g.volume)}</text></navLabel>
      <content src="${volSrc}"/>
${childPoints}
    </navPoint>`)
    } else {
      for (const { ch, name } of g.chapters) {
        chCounter++
        ncxNodes.push(`    <navPoint id="np${chCounter}" playOrder="${playOrder++}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="${name}"/>
    </navPoint>`)
      }
    }
  }
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:fanqie:${escapeXml(book.id)}"/>
    <meta name="dtb:depth" content="${hasVolumes ? '2' : '1'}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${ncxNodes.join('\n')}
  </navMap>
</ncx>`,
  )

  const manifestExtras = [
    coverImage
      ? `    <item id="cover-image" href="${coverImage.filename}" media-type="${coverImage.mediaType}" properties="cover-image"/>`
      : '',
    ...volumeFiles.map(({ id, name }) => `    <item id="${id}" href="${name}" media-type="application/xhtml+xml"/>`),
    ...chapterFiles.map(({ name, id }) => `    <item id="${id}" href="${name}" media-type="application/xhtml+xml"/>`),
  ].filter(Boolean)

  const spineRefs: string[] = [
    '    <itemref idref="cover"/>',
    '    <itemref idref="intro"/>',
  ]
  for (const g of groups) {
    if (g.pageId) spineRefs.push(`    <itemref idref="${g.pageId}"/>`)
    for (const { id } of g.chapters) spineRefs.push(`    <itemref idref="${id}"/>`)
  }

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
${coverImage ? '    <meta name="cover" content="cover-image"/>\n' : ''}${subjects}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
${manifestExtras.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineRefs.join('\n')}
  </spine>
</package>`,
  )

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}

/** 浏览器 / WebView 里的另存为（原生壳内由原生写「下载」，见 lib/saveFile.ts） */
export { saveBlob } from './saveFile'

/** 导入文档工作站阅读：同书（sourceUrl = fanqie:<bookId>）原位更新 EPUB 本体并保留阅读进度与批注 */
export async function importFanqieToDocs(book: FanqieBook, chapters: FanqieChapterRow[]): Promise<string> {
  const blob = await buildFanqieEpub(book, chapters)
  const file = new File([blob], `${sanitizeFilename(book.title)}.epub`, { type: 'application/epub+zip' })
  const sourceKey = `fanqie:${book.id}`
  const [{ db }, { importDoc }, { sha256Hex }] = await Promise.all([
    import('@/db/db'),
    import('@/db/docs'),
    import('@/lib/modelCache'),
  ])

  const existing = await db.docs
    .where('sourceUrl')
    .equals(sourceKey)
    .filter((d) => !d.deletedAt)
    .first()

  if (!existing) {
    const result = await importDoc(file)
    await db.docs.update(result.doc.id, { sourceUrl: sourceKey, updatedAt: Date.now() })
    return result.doc.id
  }

  const buf = await blob.arrayBuffer()
  const newHash = await sha256Hex(buf)
  if (newHash === existing.hash) return existing.id

  const oldHash = existing.hash
  const now = Date.now()
  const nextBlob = new Blob([buf], { type: 'application/epub+zip' })

  await db.transaction(
    'rw',
    [db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.docText, db.tombstones],
    async () => {
      await db.blobs.put({ hash: newHash, blob: nextBlob })
      await db.docs.update(existing.id, {
        hash: newHash,
        title: book.title.trim() || existing.title,
        size: nextBlob.size,
        updatedAt: now,
        sourceUrl: sourceKey,
      })

      // 迁移阅读进度、批注与书签到新 hash，并刷新 updatedAt 以便多端同步同步新锚点
      const pos = await db.positions.get(oldHash)
      if (pos) {
        await db.positions.put({ ...pos, hash: newHash, updatedAt: now })
        await db.positions.delete(oldHash)
        await db.tombstones.put({ id: oldHash, ts: now })
      }
      const anns = await db.annotations.where('docHash').equals(oldHash).toArray()
      if (anns.length) {
        await db.annotations.bulkPut(anns.map((a) => ({ ...a, docHash: newHash, updatedAt: now })))
      }
      const bms = await db.bookmarks.where('docHash').equals(oldHash).toArray()
      if (bms.length) {
        await db.bookmarks.bulkPut(bms.map((b) => ({ ...b, docHash: newHash, updatedAt: now })))
      }

      const others = await db.docs.where('hash').equals(oldHash).count()
      if (others === 0) {
        await db.blobs.delete(oldHash)
        await db.docText.delete(oldHash)
      }
    },
  )

  const updatedDoc = await db.docs.get(existing.id)
  if (updatedDoc) {
    void import('@/lib/docTextIndex').then(({ indexDoc }) => indexDoc(updatedDoc, nextBlob))
  }
  return existing.id
}
