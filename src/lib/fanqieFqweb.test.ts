import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FqwebError,
  parseBingRss,
  parseFqwebCatalog,
  parseFqwebContent,
  parseFqwebSearch,
} from './fanqieFqweb'

const { platform, tauriFetch, androidGet } = vi.hoisted(() => ({
  platform: { android: false, windows: false },
  tauriFetch: vi.fn(),
  androidGet: vi.fn(),
}))
vi.mock('./native', () => ({ isNative: () => platform.android, isTauri: () => platform.windows }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetch }))
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { get: androidGet } }))

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
    expect(() => parseFqwebCatalog({ data: 'stack trace' })).toThrow(FqwebError)
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

describe('Fanqie requests', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    platform.android = false
    platform.windows = false
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses native HTTP in Windows and ranks partial matches across both sources', async () => {
    platform.windows = true
    const webFetch = vi.fn(() => { throw new Error('Unexpected browser request') })
    vi.stubGlobal('fetch', webFetch)
    tauriFetch.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.hostname === 'cn.bing.com') {
        return new Response(`<rss><channel>
          <item><title>通神者：一斩苍穹</title><link>https://fanqienovel.com/page/123456</link></item>
          <item><title>重复</title><link>https://fanqienovel.com/page/234567</link></item>
        </channel></rss>`)
      }
      expect(url.searchParams.get('query')).toBe('通神者')
      return Response.json({ data: { code: '0', data: { list: [
        { book_id: '345678', book_name: '同类书' },
        { book_id: '234567', book_name: '通神者', author: '作者' },
      ] } } })
    })
    const { searchFanqieBooks } = await import('./fanqieFqweb')
    const hits = await searchFanqieBooks('《通神者》')
    expect(hits.map(({ bookId }) => bookId)).toEqual(['234567', '123456', '345678'])
    expect(hits[0].author).toBe('作者')
    expect(tauriFetch).toHaveBeenCalledTimes(2)
    expect(webFetch).not.toHaveBeenCalled()
  })

  it('continues looking up other keywords after a valid empty result in the browser', async () => {
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.hostname === '127.0.0.1') throw new Error('No local proxy')
      const list = url.searchParams.get('query') === '戏神' ? [bookInfo] : []
      return Response.json({ data: { code: '0', data: { list } } })
    })
    vi.stubGlobal('fetch', fetch)
    const { searchFanqieBooks } = await import('./fanqieFqweb')
    await expect(searchFanqieBooks('生僻词')).resolves.toEqual([])
    await expect(searchFanqieBooks('戏神')).resolves.toMatchObject([{ title: '我不是戏神' }])
  })

  it('falls back after invalid chapter data and reuses the working node on Android', async () => {
    platform.android = true
    androidGet.mockImplementation(async ({ url }: { url: string }) => ({
      status: 200,
      data: new URL(url).hostname === 'fq-book.nat.netsite.cc'
        ? { data: 'upstream exception' }
        : { data: { code: '0', data: { content: '正文内容' } } },
    }))
    const { fetchFanqieChapterContent } = await import('./fanqieFqweb')
    await expect(fetchFanqieChapterContent('111')).resolves.toMatchObject({ content: '正文内容' })
    await expect(fetchFanqieChapterContent('222')).resolves.toMatchObject({ content: '正文内容' })
    expect(androidGet.mock.calls.map(([request]) => new URL(request.url).hostname)).toEqual([
      'fq-book.nat.netsite.cc', 'fq-book.netsite.cc', 'fq-book.netsite.cc',
    ])
    expect(androidGet.mock.calls[0][0]).toMatchObject({ connectTimeout: 5000, readTimeout: 12000 })
  })

  it('stops chapter requests at a rate limit', async () => {
    platform.android = true
    androidGet.mockResolvedValue({ status: 429 })
    const { fetchFanqieChapterContent } = await import('./fanqieFqweb')
    await expect(fetchFanqieChapterContent('111')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(androidGet).toHaveBeenCalledTimes(1)
  })
})
