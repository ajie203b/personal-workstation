import { describe, expect, it } from 'vitest'
import {
  FqwebError,
  parseBingRss,
  parseFqwebCatalog,
  parseFqwebContent,
  parseFqwebInfo,
  parseFqwebSearch,
} from './fanqieFqweb'

const bookInfo = {
  book_id: '7276384138653862966',
  book_name: '我不是戏神',
  author: '三九音域',
  abstract: '简介 &amp; 更多',
  creation_status: 0,
  word_number: 4003607,
  serial_count: 2,
  thumb_url: 'https://example.com/cover.jpg',
  last_chapter_title: '第2章 继续',
  last_chapter_update_time: 1_700_000_000,
  tags: '都市高武,穿越',
  category: '都市高武',
}

const catalog = {
  data: {
    code: '0',
    data: {
      book_info: bookInfo,
      item_data_list: [
        { item_id: '111', title: '第1章 开端', volume_name: '第一卷', chapter_word_number: 2000 },
        { item_id: '222', title: '第2章 继续', volume_name: '第一卷', chapter_word_number: 2100 },
      ],
    },
  },
}

describe('parseFqwebCatalog', () => {
  it('maps book info and chapters', () => {
    const book = parseFqwebCatalog(catalog)
    expect(book.bookId).toBe('7276384138653862966')
    expect(book.title).toBe('我不是戏神')
    expect(book.author).toBe('三九音域')
    expect(book.status).toBe('已完结')
    expect(book.statusKind).toBe('done')
    expect(book.wordCount).toBe(4003607)
    expect(book.chapterCount).toBe(2)
    expect(book.tags).toEqual(['都市高武', '穿越'])
    expect(book.updatedAt).toBe(1_700_000_000_000)
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[1]).toMatchObject({
      itemId: '222',
      title: '第2章 继续',
      volume: '第一卷',
      index: 2,
      wordCount: 2100,
      locked: false,
    })
  })

  it('falls back to catalog_data when item_data_list is empty', () => {
    const book = parseFqwebCatalog({
      data: {
        code: '0',
        data: { book_info: bookInfo, catalog_data: [{ item_id: '1', title: '一' }] },
      },
    })
    expect(book.chapters).toHaveLength(1)
  })

  it('throws on an error payload', () => {
    expect(() => parseFqwebCatalog({ data: { code: '500', data: {}, message: 'bad' } })).toThrow(FqwebError)
    expect(() => parseFqwebInfo({ data: 'stack trace' })).toThrow(FqwebError)
  })
})

describe('parseFqwebContent', () => {
  it('cleans plain text and returns the book id', () => {
    const data = parseFqwebContent({
      data: {
        code: '0',
        data: {
          title: '第11章 审判',
          content: '\u3000\u3000第一段\n\n\n\u3000\u3000第二段',
          novel_data: { book_id: '7276384138653862966' },
        },
      },
    })
    expect(data.title).toBe('第11章 审判')
    expect(data.content).toBe('第一段\n\n第二段')
    expect(data.bookId).toBe('7276384138653862966')
    expect(data.unknownGlyphs).toBe(false)
  })

  it('handles HTML content from published books', () => {
    const data = parseFqwebContent({
      data: {
        code: '0',
        data: { title: '第1章', content: '<p>第一段</p><p>第二段&amp;符号</p>' },
      },
    })
    expect(data.content).toBe('第一段\n\n第二段&符号')
  })

  it('rejects empty content', () => {
    expect(() => parseFqwebContent({ data: { code: '0', data: { content: '   ' } } })).toThrow(FqwebError)
  })
})

describe('parseFqwebSearch', () => {
  it('extracts books from search_tabs/book_data', () => {
    const items = parseFqwebSearch({
      data: {
        code: '0',
        data: {
          search_tabs: [
            {
              data: [
                {
                  book_data: [
                    {
                      book_id: '111',
                      book_name: '测试书',
                      author: '作者',
                      creation_status: 1,
                      serial_count: 88,
                      word_number: 123456,
                      thumb_url: 'https://example.com/c.jpg',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      bookId: '111',
      title: '测试书',
      author: '作者',
      status: '连载中',
      chapterCount: 88,
      wordCount: 123456,
    })
  })

  it('returns empty for an error string', () => {
    expect(parseFqwebSearch({ data: 'NullPointerException' })).toEqual([])
  })
})

describe('parseBingRss', () => {
  it('extracts unique fanqienovel page ids and strips site suffixes', () => {
    const xml = `<rss><channel>
      <item><title>我不是戏神_番茄小说官网</title><link>https://fanqienovel.com/page/7276384138653862966</link><description>《我不是戏神》</description></item>
      <item><title>重复</title><link>https://fanqienovel.com/page/7276384138653862966</link></item>
      <item><title>无关结果</title><link>https://example.com/book</link></item>
    </channel></rss>`
    const hits = parseBingRss(xml)
    expect(hits).toEqual([{ bookId: '7276384138653862966', title: '我不是戏神' }])
  })

  it('finds the page id in the description', () => {
    const xml = `<rss><channel><item>
      <title>测试</title>
      <link>https://example.com/redirect</link>
      <description>原文 https://fanqienovel.com/page/1234567890123456789 阅读</description>
    </item></channel></rss>`
    expect(parseBingRss(xml)).toEqual([{ bookId: '1234567890123456789', title: '测试' }])
  })
})
