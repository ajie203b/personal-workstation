import { FANQIE_FONT_KEY, decodeFanqieText, hasUnknownFanqieGlyphs } from './fanqieFont'
import { fmtListDate } from './date'

/** 番茄书籍/章节链接或 ID 的解析结果；auto = 只有数字，先按书 ID 试，失败再按章节 ID 试 */
export interface FanqieRef {
  kind: 'book' | 'chapter' | 'auto'
  id: string
}

export interface FanqieChapterMeta {
  itemId: string
  title: string
  /** 在整本书里的序号，从 1 开始 */
  index: number
  volume?: string
  /** 官网标记为锁定/付费；FQWeb 正文接口不受此限制 */
  locked: boolean
  paid: boolean
  /** 官网/目录给的字数，用于校验正文是否被截断 */
  wordCount?: number
}

export interface FanqieBookInfo {
  bookId: string
  title: string
  author: string
  cover?: string
  abstract: string
  /** 已完结 / 连载中 / 已断更…（官网原样） */
  status: string
  statusKind: 'done' | 'serial' | 'unknown'
  wordCount?: number
  chapterCount: number
  tags: string[]
  lastChapterTitle?: string
  updatedAt?: number
  chapters: FanqieChapterMeta[]
  fetchedAt: number
  /** @font-face 里的字体指纹；和内置表不一致时正文可能夹方框 */
  fontKey?: string
  fontChanged: boolean
}

export interface FanqieChapterData {
  itemId: string
  title: string
  content: string
  wordCount?: number
  locked: boolean
  truncated: boolean
  nextItemId?: string
  bookId?: string
  fontKey?: string
  unknownGlyphs: boolean
}

export class FanqieParseError extends Error {
  constructor(message = '番茄页面结构无法解析') {
    super(message)
    this.name = 'FanqieParseError'
  }
}

/** 支持：书籍页链接、章节页链接、分享文本里的链接、book_id=…、纯数字 ID */
export function parseFanqieRef(input: string): FanqieRef | null {
  const text = input.trim()
  if (!text) return null
  const reader = text.match(/(?:fanqienovel\.com|fqnovel\.com)\/reader\/(\d{6,20})/i)
  if (reader) return { kind: 'chapter', id: reader[1] }
  const page = text.match(/(?:fanqienovel\.com|fqnovel\.com)\/page\/(\d{6,20})/i)
  if (page) return { kind: 'book', id: page[1] }
  const query = text.match(/(?:book_id|bookId|bookid|item_id|itemId)=(\d{6,20})/i)
  if (query) return { kind: 'auto', id: query[1] }
  const raw = text.match(/^(\d{6,20})$/)
  if (raw) return { kind: 'auto', id: raw[1] }
  return null
}

/**
 * 从页面内联的 window.__INITIAL_STATE__ 里取状态对象。
 * 直接 JSON.parse 整段会碰到后面的脚本，所以只截到第一层花括号闭合处。
 */
export function extractInitialState(html: string): unknown | null {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/.exec(html)
  if (!marker) return null
  const start = html.indexOf('{', marker.index + marker[0].length)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—',
}

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const n = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return all
      try {
        return String.fromCodePoint(n)
      } catch {
        return all
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? all
  })
}

/** 正文 HTML → 纯文本；保留 <p>/<br> 的段落边界，丢掉图片和脚本 */
export function chapterHtmlToText(raw: string): string {
  let s = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|h[1-6]|li|blockquote)>/gi, '\n\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeHtmlEntities(s)
  s = s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseStatus(label: string, creationStatus: unknown): Pick<FanqieBookInfo, 'status' | 'statusKind'> {
  const status = label || (creationStatus === 0 ? '已完结' : creationStatus === 1 ? '连载中' : '状态未知')
  if (/完结|断更|太监/.test(status)) return { status, statusKind: 'done' }
  if (/连载|更新/.test(status)) return { status, statusKind: 'serial' }
  return { status, statusKind: 'unknown' }
}

function parseFontKey(html: string): string | undefined {
  return /awesome-font\/c\/([a-z0-9]+)/i.exec(html)?.[1]
}

function flattenChapters(page: Record<string, unknown>): FanqieChapterMeta[] {
  const volumes = asArray(page.chapterListWithVolume)
  const out: FanqieChapterMeta[] = []
  const seen = new Set<string>()
  for (const vol of volumes) {
    for (const raw of asArray(vol)) {
      const ch = obj(raw)
      if (!ch) continue
      const itemId = asString(ch.itemId)
      if (!itemId || seen.has(itemId)) continue
      seen.add(itemId)
      const paid = ch.isPaidPublication === true || ch.isPaidStory === true || (asNumber(ch.needPay) ?? 0) > 0
      out.push({
        itemId,
        title: decodeHtmlEntities(asString(ch.title)),
        index: out.length + 1,
        volume: decodeHtmlEntities(asString(ch.volume_name)) || undefined,
        locked: ch.isChapterLock === true || paid,
        paid,
      })
    }
  }
  return out
}

/** 解析书籍详情页；目录跟着 SSR 一起回来，不用再打接口 */
export function parseBookPage(html: string): FanqieBookInfo {
  const state = obj(extractInitialState(html))
  const page = obj(state?.page)
  if (!page) throw new FanqieParseError('书籍页没有找到 __INITIAL_STATE__.page')

  const bookId = asString(page.bookId)
  const title = decodeHtmlEntities(asString(page.bookName)) || decodeHtmlEntities(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '').trim()
  if (!bookId || !title) throw new FanqieParseError('书籍页缺少书名或 bookId')

  const chapters = flattenChapters(page)
  const statusLabel = decodeHtmlEntities(
    /<span[^>]*class="info-label-yellow"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1] ?? '',
  ).trim()
  const categoryTags = asArray(page.categoryV2)
    .map((x) => decodeHtmlEntities(asString(obj(x)?.Name)))
    .filter(Boolean)
  if (!categoryTags.length) {
    const re = /<span[^>]*class="info-label-grey"[^>]*>([\s\S]*?)<\/span>/gi
    for (let m = re.exec(html); m; m = re.exec(html)) {
      const t = decodeHtmlEntities(m[1]).trim()
      if (t) categoryTags.push(t)
    }
  }

  const authorRaw = page.authorName ?? page.author ?? (asArray(page.originalAuthors).map((x) => obj(x)?.AuthorName)[0])
  const fontKey = parseFontKey(html)
  const lastPublish = asNumber(page.lastPublishTime)

  return {
    bookId,
    title,
    author: decodeHtmlEntities(asString(authorRaw)) || '佚名',
    cover: asString(page.thumbUrl) || asString(page.thumbUri) || undefined,
    abstract: decodeHtmlEntities(asString(page.abstract) || asString(page.description)).trim(),
    ...parseStatus(statusLabel, page.creationStatus),
    wordCount: asNumber(page.wordNumber),
    chapterCount: chapters.length || (asNumber(page.chapterTotal) ?? 0),
    tags: [...new Set(categoryTags)].slice(0, 6),
    lastChapterTitle: decodeHtmlEntities(asString(page.lastChapterTitle)) || undefined,
    updatedAt: lastPublish ? lastPublish * 1000 : undefined,
    chapters,
    fetchedAt: Date.now(),
    fontKey,
    fontChanged: Boolean(fontKey) && fontKey !== FANQIE_FONT_KEY,
  }
}

/** 目录接口兜底：书籍页结构变化时，至少还能拿到章节列表 */
export function parseDirectoryJson(raw: unknown): FanqieChapterMeta[] {
  const data = obj(obj(raw)?.data)
  if (!data) throw new FanqieParseError('目录接口返回为空')
  const volumes = asArray(data.chapterListWithVolume)
  if (!volumes.length) throw new FanqieParseError('目录接口没有章节')
  return flattenChapters({ chapterListWithVolume: volumes })
}

function buildChapterData(cd: Record<string, unknown>, fontKey?: string): FanqieChapterData {
  const itemId = asString(cd.itemId)
  const rawContent = asString(cd.content)
  const content = decodeFanqieText(chapterHtmlToText(rawContent))
  const wordCount = asNumber(cd.chapterWordNumber) ?? asNumber(cd.wordCount)
  const locked = cd.isChapterLock === true || cd.isPaidPublication === true || cd.isPaidStory === true
  const visible = content.replace(/\s/g, '').length
  // 锁定章节只给约 200 字试读；用官方字数和实际正文对比判断是否被截断
  const truncated = Boolean(locked && (!content || (wordCount && wordCount > 0 && visible < wordCount * 0.7)))
  return {
    itemId,
    title: decodeHtmlEntities(asString(cd.title)),
    content,
    wordCount,
    locked,
    truncated,
    nextItemId: asString(cd.nextItemId) || undefined,
    bookId: asString(cd.bookId) || undefined,
    fontKey,
    unknownGlyphs: hasUnknownFanqieGlyphs(content),
  }
}

/** 解析章节阅读页（SSR 正文） */
export function parseChapterPage(html: string): FanqieChapterData {
  const state = obj(extractInitialState(html))
  const cd = obj(obj(state?.reader)?.chapterData)
  if (!cd) throw new FanqieParseError('章节页没有找到 __INITIAL_STATE__.reader.chapterData')
  const data = buildChapterData(cd, parseFontKey(html))
  if (!data.itemId) throw new FanqieParseError('章节页缺少 itemId')
  return data
}

/** 解析 /api/reader/full 的 JSON（登录 Cookie 下可能拿到完整正文） */
export function parseChapterJson(raw: unknown): FanqieChapterData | null {
  const cd = obj(obj(obj(raw)?.data)?.chapterData)
  if (!cd) return null
  const data = buildChapterData(cd)
  return data.itemId && data.content ? data : null
}

export function formatWordCount(n?: number): string {
  if (!n || n <= 0) return ''
  if (n < 10000) return `${n} 字`
  if (n < 100000000) {
    const v = n / 10000
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')} 万字`
  }
  return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')} 亿字`
}

export function formatDate(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return fmtListDate(d)
}
