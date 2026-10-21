import { describe, expect, it } from 'vitest'
import {
  chapterHtmlToText,
  decodeHtmlEntities,
  extractInitialState,
  formatWordCount,
  parseBookPage,
  parseChapterJson,
  parseChapterPage,
  parseDirectoryJson,
  parseFanqieRef,
} from './fanqie'
import { decodeFanqieText, hasUnknownFanqieGlyphs } from './fanqieFont'

const FONT_CSS =
  '@font-face{src:url(https://lf6-awef.bytetos.com/obj/awesome-font/c/dc027189e0ba4cd.woff2)format("woff2")}'

function htmlWithState(state: unknown): string {
  return `<html><head><style>${FONT_CSS}</style></head><body>
<span class="info-label-yellow">已完结</span>
<script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script>
</body></html>`
}

const bookState = {
  page: {
    bookId: '9999999999999999999',
    bookName: '测试书',
    authorName: '测试作者',
    abstract: '这是简介 &amp; 续行',
    creationStatus: 0,
    wordNumber: 12345,
    chapterTotal: 2,
    thumbUrl: 'https://example.com/cover.jpg',
    lastChapterTitle: '第2章 继续',
    lastPublishTime: 1_700_000_000,
    categoryV2: [{ Name: '悬疑' }, { Name: '推理' }],
    chapterListWithVolume: [
      [
        { itemId: '1111111111111111111', title: '第1章 开端', isChapterLock: false, volume_name: '第一卷' },
        { itemId: '2222222222222222222', title: '第2章 &amp; 继续', isChapterLock: true, volume_name: '第一卷', needPay: 12 },
      ],
    ],
  },
}

describe('parseFanqieRef', () => {
  it('recognizes page, reader, share text and raw ids', () => {
    expect(parseFanqieRef('https://fanqienovel.com/page/7143038691944959011')).toEqual({
      kind: 'book',
      id: '7143038691944959011',
    })
    expect(parseFanqieRef('https://fanqienovel.com/reader/7173216089122439711')).toEqual({
      kind: 'chapter',
      id: '7173216089122439711',
    })
    expect(parseFanqieRef('分享给你《十日终焉》 https://fanqienovel.com/page/7143038691944959011 看看吧')).toEqual({
      kind: 'book',
      id: '7143038691944959011',
    })
    expect(parseFanqieRef('book_id=7143038691944959011&foo=1')).toEqual({
      kind: 'auto',
      id: '7143038691944959011',
    })
    expect(parseFanqieRef('7143038691944959011')).toEqual({ kind: 'auto', id: '7143038691944959011' })
  })

  it('rejects junk', () => {
    expect(parseFanqieRef('')).toBeNull()
    expect(parseFanqieRef('https://example.com/page/123456789')).toBeNull()
    expect(parseFanqieRef('123')).toBeNull()
  })
})

describe('extractInitialState', () => {
  it('stops at the matching brace, even with braces in strings', () => {
    const state = { page: { title: 'a } b { c', quote: '"' }, list: [1, 2, 3] }
    expect(extractInitialState(htmlWithState(state))).toEqual(state)
  })

  it('returns null when the marker is missing', () => {
    expect(extractInitialState('<html></html>')).toBeNull()
  })
})

describe('HTML text helpers', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;&#39;&#x4e00;&nbsp;')).toBe('&<>"\'一 ')
  })

  it('keeps paragraph breaks and drops scripts/tags', () => {
    const text = chapterHtmlToText(
      '<script>alert(1)</script><p>第一段</p><p>第二段&amp;符号</p><br/>第三行<img src="x"/>',
    )
    expect(text).toBe('第一段\n\n第二段&符号\n\n第三行')
  })
})

describe('font decoding', () => {
  it('maps private-use code points to characters', () => {
    expect(decodeFanqieText('\ue4de\ue3e8')).toBe('一D')
    expect(decodeFanqieText('正常abc')).toBe('正常abc')
  })

  it('flags code points whose glyph is unknown', () => {
    expect(hasUnknownFanqieGlyphs('\ue4de')).toBe(false)
    // 表里第 15 个位置是 '?'
    expect(hasUnknownFanqieGlyphs('\ue3f6')).toBe(true)
  })
})

describe('parseBookPage', () => {
  it('parses metadata, tags and chapter list', () => {
    const book = parseBookPage(htmlWithState(bookState))
    expect(book.bookId).toBe('9999999999999999999')
    expect(book.title).toBe('测试书')
    expect(book.author).toBe('测试作者')
    expect(book.abstract).toBe('这是简介 & 续行')
    expect(book.status).toBe('已完结')
    expect(book.statusKind).toBe('done')
    expect(book.tags).toEqual(['悬疑', '推理'])
    expect(book.wordCount).toBe(12345)
    expect(book.chapterCount).toBe(2)
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[1]).toMatchObject({
      itemId: '2222222222222222222',
      title: '第2章 & 继续',
      locked: true,
      paid: true,
      volume: '第一卷',
      index: 2,
    })
    expect(book.fontKey).toBe('dc027189e0ba4cd')
    expect(book.fontChanged).toBe(false)
  })

  it('throws when page state is missing', () => {
    expect(() => parseBookPage('<html></html>')).toThrow()
  })
})

describe('parseChapterPage', () => {
  const base = {
    itemId: '1111111111111111111',
    title: '第1章 开端',
    content: '<p>\ue4de</p><p>第二段</p>',
    chapterWordNumber: '4',
    isChapterLock: false,
    bookId: '9999999999999999999',
    nextItemId: '2222222222222222222',
  }

  it('decodes content and keeps metadata', () => {
    const data = parseChapterPage(
      htmlWithState({ reader: { chapterData: base } }),
    )
    expect(data.content).toBe('一\n\n第二段')
    expect(data.locked).toBe(false)
    expect(data.truncated).toBe(false)
    expect(data.bookId).toBe('9999999999999999999')
    expect(data.nextItemId).toBe('2222222222222222222')
  })

  it('marks locked short previews as truncated', () => {
    const data = parseChapterPage(
      htmlWithState({
        reader: {
          chapterData: { ...base, isChapterLock: true, chapterWordNumber: '2000', content: '<p>只有一点</p>' },
        },
      }),
    )
    expect(data.locked).toBe(true)
    expect(data.truncated).toBe(true)
  })

  it('parses the /api/reader/full shape', () => {
    const data = parseChapterJson({ data: { chapterData: base } })
    expect(data?.content).toBe('一\n\n第二段')
  })
})

describe('parseDirectoryJson', () => {
  it('flattens volumes', () => {
    const chapters = parseDirectoryJson({
      data: {
        chapterListWithVolume: [
          [{ itemId: '1', title: '一' }, { itemId: '2', title: '二' }],
          [{ itemId: '3', title: '三' }],
        ],
      },
    })
    expect(chapters.map((c) => c.index)).toEqual([1, 2, 3])
    expect(chapters.map((c) => c.title)).toEqual(['一', '二', '三'])
  })
})

describe('formatWordCount', () => {
  it('formats Chinese units', () => {
    expect(formatWordCount(0)).toBe('')
    expect(formatWordCount(999)).toBe('999 字')
    expect(formatWordCount(12345)).toBe('1.2 万字')
    expect(formatWordCount(120000)).toBe('12 万字')
    expect(formatWordCount(123456789)).toBe('1.2 亿字')
  })
})
