import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db, type FanqieBook, type FanqieChapterRow } from '@/db/db'
import { buildFanqieEpub, buildFanqieTxt, escapeXml, importFanqieToDocs, sanitizeFilename } from './fanqieExport'

vi.mock('@/lib/docTextIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/docTextIndex')>()),
  indexDoc: vi.fn().mockResolvedValue(undefined),
}))

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

describe('importFanqieToDocs', () => {
  it('同书追加章节原位更新 EPUB，保留文档 ID 并迁移阅读进度、批注与书签', async () => {
    await db.delete()
    await db.open()

    const firstId = await importFanqieToDocs(book, rows)
    const firstDoc = await db.docs.get(firstId)
    expect(firstDoc?.sourceUrl).toBe(`fanqie:${book.id}`)
    const oldHash = firstDoc!.hash

    await db.positions.put({
      hash: oldHash,
      progress: { kind: 'flow', segIdx: 1, ratio: 0.5 },
      progressPct: 0.5,
      updatedAt: 100,
    })
    await db.annotations.put({
      id: 'ann-fq-1',
      docHash: oldHash,
      text: '关键伏笔',
      color: 'yellow',
      createdAt: 100,
      updatedAt: 100,
    })
    await db.bookmarks.put({
      id: 'bm-fq-1',
      docHash: oldHash,
      label: '第一章重点',
      anchor: 'b1',
      createdAt: 100,
      updatedAt: 100,
    })
    await db.docText.put({
      hash: oldHash,
      kind: 'epub',
      text: 'old index',
      indexedAt: 100,
    })

    const nextRows: FanqieChapterRow[] = [
      ...rows,
      {
        id: '9999999999999999999:3',
        bookId: book.id,
        itemId: '3',
        index: 3,
        title: '第3章 新篇',
        volume: '第一卷',
        content: '第三章全新内容',
        savedAt: 2,
      },
    ]
    const secondId = await importFanqieToDocs({ ...book, chapterCount: 3, downloadedCount: 3 }, nextRows)
    expect(secondId).toBe(firstId)
    expect(await db.docs.count()).toBe(1)

    const updatedDoc = await db.docs.get(firstId)
    expect(updatedDoc).toBeDefined()
    const newHash = updatedDoc!.hash
    expect(newHash).not.toBe(oldHash)

    // 阅读进度、批注、书签全部迁移至新 hash，旧 hash 写墓碑且旧孤儿资源释放
    expect((await db.positions.get(newHash))?.progressPct).toBe(0.5)
    expect(await db.positions.get(oldHash)).toBeUndefined()
    expect(await db.tombstones.get(oldHash)).toBeDefined()

    const migratedAnns = await db.annotations.where('docHash').equals(newHash).toArray()
    expect(migratedAnns).toHaveLength(1)
    expect(migratedAnns[0].text).toBe('关键伏笔')
    expect((migratedAnns[0].updatedAt ?? 0)).toBeGreaterThan(100)

    const migratedBms = await db.bookmarks.where('docHash').equals(newHash).toArray()
    expect(migratedBms).toHaveLength(1)
    expect(migratedBms[0].label).toBe('第一章重点')
    expect((migratedBms[0].updatedAt ?? 0)).toBeGreaterThan(100)

    expect(await db.blobs.get(oldHash)).toBeUndefined()
    expect(await db.docText.get(oldHash)).toBeUndefined()
    expect(await db.blobs.get(newHash)).toBeDefined()
  })
})
