import { describe, expect, it } from 'vitest'
import type { FanqieBook, FanqieChapterRow } from '@/db/db'
import { buildFanqieEpub, buildFanqieTxt, sanitizeFilename } from './fanqieExport'

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
})
