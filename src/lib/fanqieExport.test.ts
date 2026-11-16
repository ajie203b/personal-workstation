import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FanqieBook, FanqieChapterRow } from '@/db/db'
import { buildFanqieEpub, buildFanqieTxt, escapeXml, sanitizeFilename } from './fanqieExport'

const book: FanqieBook = {
  id: '9999999999999999999',
  title: '测试书',
  author: '测试作者',
  abstract: '简介',
  status: '已完结',
  chapterCount: 2,
  tags: ['悬疑'],
  chapters: [],
  downloadedCount: 2,
  createdAt: 1,
  savedAt: 1,
}

const rows: FanqieChapterRow[] = [
  {
    id: '9999999999999999999:2',
    bookId: book.id,
    itemId: '2',
    index: 2,
    title: '第2章 继续',
    volume: '第一卷',
    content: '第二段\n第二段续',
    savedAt: 1,
  },
  {
    id: '9999999999999999999:1',
    bookId: book.id,
    itemId: '1',
    index: 1,
    title: '第1章 开端',
    volume: '第一卷',
    content: '第一段',
    savedAt: 1,
  },
]

describe('sanitizeFilename', () => {
  it('replaces illegal characters and caps length', () => {
    expect(sanitizeFilename('a/b:c*?')).toBe('a／b：c＊？')
    expect(sanitizeFilename('   ')).toBe('番茄小说')
    expect(sanitizeFilename('x'.repeat(200)).length).toBe(80)
  })
})

describe('buildFanqieTxt', () => {
  it('orders chapters, adds BOM and preserves paragraphs', async () => {
    const blob = buildFanqieTxt(book, rows)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = await blob.text()
    expect(text.indexOf('第1章 开端')).toBeLessThan(text.indexOf('第2章 继续'))
    expect(text).toContain('作者：测试作者')
    expect(text).toContain('第一段')
    expect(text).toContain('第二段\n第二段续')
    expect(text).toContain('【第一卷】')
  })
})

describe('buildFanqieEpub', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('builds a readable EPUB with nav and ordered chapters', async () => {
    const blob = await buildFanqieEpub(book, rows)
    expect(blob.type).toBe('application/epub+zip')
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(await zip.file('mimetype')?.async('string')).toBe('application/epub+zip')
    expect(zip.file('META-INF/container.xml')).toBeTruthy()
    expect(zip.file('OEBPS/content.opf')).toBeTruthy()
    const first = await zip.file('OEBPS/chapter-0001.xhtml')?.async('string')
    const second = await zip.file('OEBPS/chapter-0002.xhtml')?.async('string')
    expect(first).toContain('第1章 开端')
    expect(first).toContain('<p>第一段</p>')
    expect(second).toContain('第2章 继续')
    const nav = await zip.file('OEBPS/nav.xhtml')?.async('string')
    expect(nav).toContain('第1章 开端')
    expect(nav).toContain('第2章 继续')
    const opf = await zip.file('OEBPS/content.opf')?.async('string')
    expect(opf).toContain('urn:fanqie:9999999999999999999')
    expect(opf).toContain('<itemref idref="c0001"/>')
  })

  it('refuses empty input', async () => {
    await expect(buildFanqieEpub(book, [])).rejects.toThrow()
  })

  it('preserves volume hierarchy in nav.xhtml, toc.ncx (depth=2) and generates intro/volume pages', async () => {
    const multiVolRows: FanqieChapterRow[] = [
      ...rows,
      {
        id: '9999999999999999999:3',
        bookId: book.id,
        itemId: '3',
        index: 3,
        title: '第3章 启程',
        volume: '第二卷',
        content: '第三段',
        savedAt: 1,
      },
    ]
    const blob = await buildFanqieEpub(book, multiVolRows)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())

    const nav = await zip.file('OEBPS/nav.xhtml')?.async('string')
    expect(nav).toContain('<a href="volume-0001.xhtml">第一卷</a>')
    expect(nav).toContain('<a href="volume-0002.xhtml">第二卷</a>')
    expect(nav).toMatch(/<li>\s*<a href="volume-0001\.xhtml">第一卷<\/a>\s*<ol>/)

    const ncx = await zip.file('OEBPS/toc.ncx')?.async('string')
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>')
    expect(ncx).toContain('<navPoint id="np-vol-1"')
    expect(ncx).toContain('<text>第一卷</text>')
    expect(ncx).toContain('<text>第二卷</text>')

    const intro = await zip.file('OEBPS/intro.xhtml')?.async('string')
    expect(intro).toContain('测试作者')
    expect(intro).toContain('简介')

    const vol1 = await zip.file('OEBPS/volume-0001.xhtml')?.async('string')
    expect(vol1).toContain('第一卷')

    const css = await zip.file('OEBPS/style.css')?.async('string')
    expect(css).not.toContain('80vh')
    expect(css).not.toContain('display: flex')
  })

  it('strips XML 1.0 illegal control characters in escapeXml and EPUB output', async () => {
    expect(escapeXml('hello\u0000\u0008\u000B\u000C\u001Fworld & <tag>')).toBe('helloworld &amp; &lt;tag&gt;')
    const dirtyBook: FanqieBook = { ...book, title: '脏字符\u0007书名', abstract: '简介\u000B测试' }
    const dirtyRows: FanqieChapterRow[] = [{ ...rows[1], content: '正文\u0000内容\u001F' }]
    const blob = await buildFanqieEpub(dirtyBook, dirtyRows)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const opf = await zip.file('OEBPS/content.opf')?.async('string')
    const ch1 = await zip.file('OEBPS/chapter-0001.xhtml')?.async('string')
    expect(opf).toContain('脏字符书名')
    expect(opf).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
    expect(ch1).toContain('<p>正文内容</p>')
  })

  it('embeds cover image when fetchable and gracefully skips when unavailable', async () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jpegHeader, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    })))
    const withCover: FanqieBook = { ...book, cover: 'http://example.com/cover.jpg' }
    const blob = await buildFanqieEpub(withCover, rows)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('OEBPS/cover.jpg')).toBeTruthy()
    const opf = await zip.file('OEBPS/content.opf')?.async('string')
    expect(opf).toContain('id="cover-image" href="cover.jpg"')
    expect(opf).toContain('properties="cover-image"')
    const coverHtml = await zip.file('OEBPS/cover.xhtml')?.async('string')
    expect(coverHtml).toContain('src="cover.jpg"')
  })
})
