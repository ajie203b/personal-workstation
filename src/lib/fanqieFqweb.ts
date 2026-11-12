import { CapacitorHttp } from '@capacitor/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isNative, isTauri } from './native'
import type { FanqieBookInfo, FanqieChapterMeta, FanqieRef } from './fanqie'
import { chapterHtmlToText, decodeHtmlEntities } from './fanqie'
import { decodeFanqieText, hasUnknownFanqieGlyphs } from './fanqieFont'

/**
 * 正文/目录来自公开的 FQWeb 节点（番茄 App 协议服务）。
 * 公共节点可用性会变化。搜索同时参考 FQWeb 和 Bing 对番茄书籍页面的索引。
 */
const FQWEB_BASES = [
  'https://fq-book.nat.netsite.cc:8043',
  'https://fq-book.netsite.cc',
]
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const LOCAL_PROXY = 'http://127.0.0.1:8787/?url='
const BING_SEARCH = 'https://cn.bing.com/search'
const SEARCH_TIMEOUT = 5_000

export type FqwebErrorCode =
  | 'UNAVAILABLE'
  | 'BAD_DATA'
  | 'EMPTY'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'

export class FqwebError extends Error {
  code: FqwebErrorCode
  constructor(code: FqwebErrorCode, message: string) {
    super(message)
    this.name = 'FqwebError'
    this.code = code
  }
}

export interface FanqieSearchItem {
  bookId: string
  title: string
  author?: string
  cover?: string
  abstract?: string
  status?: string
  wordCount?: number
  chapterCount?: number
}

export interface FqwebChapterContent {
  title: string
  content: string
  bookId?: string
  unknownGlyphs: boolean
}

/* ---------------- 基础请求 ---------------- */

function chinaDate(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function buildUrl(base: string, path: string, params?: Record<string, string | number>): string {
  const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`)
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v))
  url.searchParams.set('nt', chinaDate())
  return url.toString()
}

function checkStatus(status: number) {
  if (status === 429) throw new FqwebError('RATE_LIMITED', '书源请求过多，请稍后重试')
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
}

async function nativeFetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const res = await CapacitorHttp.get({
    url,
    headers: { 'User-Agent': DESKTOP_UA, Accept: accept },
    responseType: 'text',
    connectTimeout: Math.min(timeoutMs, 5_000),
    readTimeout: timeoutMs,
  })
  checkStatus(res.status)
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
}

async function fetchText(url: string, timeoutMs: number, accept = 'application/json, text/plain, */*') {
  if (isNative()) return nativeFetchText(url, timeoutMs, accept)
  const headers = { Accept: accept }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const signal = controller.signal
    const res = isTauri()
      ? await tauriFetch(url, { headers, signal, connectTimeout: Math.min(timeoutMs, 5_000) })
      : await fetch(url, { headers, signal, cache: 'no-store' })
    checkStatus(res.status)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

let chapterBase = FQWEB_BASES[0]

async function fqwebRequest<T>(
  path: string,
  params: Record<string, string | number>,
  timeoutMs: number,
  parse: (raw: unknown) => T,
): Promise<T> {
  const preferred = path === '/content' ? chapterBase : FQWEB_BASES[0]
  const bases = [preferred, ...FQWEB_BASES.filter((base) => base !== preferred)]
  let dataError: FqwebError | undefined
  for (const base of bases) {
    try {
      const text = await fetchText(buildUrl(base, path, params), timeoutMs)
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new FqwebError('BAD_DATA', '书源返回的不是有效 JSON')
      }
      const result = parse(raw)
      if (path === '/content' && base !== preferred) chapterBase = base
      return result
    } catch (e) {
      if (e instanceof FqwebError) {
        if (e.code === 'RATE_LIMITED') throw e
        if (!dataError || e.code === 'NOT_FOUND') dataError = e
      }
    }
  }
  throw dataError ?? new FqwebError('UNAVAILABLE', '书源暂时连不上')
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function msFromSeconds(v: unknown): number | undefined {
  const n = num(v)
  if (!n) return undefined
  return n > 10_000_000_000 ? n : n * 1000
}

/** FQWeb 统一外壳：{ data: { code:"0", data: {...}, message } } */
function payload(raw: unknown): Record<string, unknown> {
  const outer = obj(obj(raw)?.data)
  if (!outer) throw new FqwebError('BAD_DATA', '接口没有返回 data')
  const code = outer.code
  if (code != null && String(code) !== '0' && String(code) !== '200') {
    throw new FqwebError('BAD_DATA', str(outer.message) || `接口 code=${String(code)}`)
  }
  const inner = obj(outer.data)
  if (!inner) throw new FqwebError('BAD_DATA', '接口 data 为空')
  return inner
}

/* ---------------- 书籍信息 / 目录 / 正文 ---------------- */

function tagsOf(raw: Record<string, unknown>): string[] {
  const tags = raw.tags
  if (Array.isArray(tags)) return tags.map((t) => str(t)).filter(Boolean).slice(0, 6)
  if (typeof tags === 'string') return tags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean).slice(0, 6)
  const cat = str(raw.category)
  return cat ? [cat] : []
}

function bookFromRaw(raw: Record<string, unknown>, chapters: FanqieChapterMeta[] = []): FanqieBookInfo {
  const bookId = str(raw.book_id)
  if (!bookId) throw new FqwebError('BAD_DATA', '书籍信息缺少 book_id')
  const completed = num(raw.creation_status) === 0
  return {
    bookId,
    title: str(raw.book_name) || str(raw.book_short_name) || `番茄小说 ${bookId}`,
    author: str(raw.author) || '佚名',
    cover: str(raw.detail_page_thumb_url) || str(raw.thumb_url) || str(raw.audio_thumb_uri) || undefined,
    abstract: str(raw.abstract) || str(raw.book_abstract_v2) || '',
    status: completed ? '已完结' : '连载中',
    statusKind: completed ? 'done' : 'serial',
    wordCount: num(raw.word_number),
    chapterCount: chapters.length || num(raw.serial_count) || 0,
    tags: tagsOf(raw),
    lastChapterTitle: str(raw.last_chapter_title) || undefined,
    updatedAt: msFromSeconds(raw.last_chapter_update_time ?? raw.last_publish_time),
    chapters,
    fetchedAt: Date.now(),
    fontChanged: false,
  }
}

function chapterFromRaw(raw: unknown, index: number): FanqieChapterMeta | null {
  const ch = obj(raw)
  if (!ch) return null
  const itemId = str(ch.item_id)
  if (!itemId) return null
  return {
    itemId,
    title: decodeHtmlEntities(str(ch.title)),
    index,
    volume: decodeHtmlEntities(str(ch.volume_name)) || undefined,
    // FQWeb 的 content 接口对目录里标记锁定的章也返回完整正文
    locked: false,
    paid: false,
    wordCount: num(ch.chapter_word_number),
  }
}

/** /catalog：一次拿书信息 + 全目录（约 1MB） */
export function parseFqwebCatalog(raw: unknown): FanqieBookInfo {
  const inner = payload(raw)
  const infoRaw = obj(inner.book_info)
  if (!infoRaw) throw new FqwebError('BAD_DATA', '目录里没有书籍信息')
  const list = Array.isArray(inner.item_data_list)
    ? inner.item_data_list
    : Array.isArray(inner.catalog_data)
      ? inner.catalog_data
      : []
  const chapters: FanqieChapterMeta[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const ch = chapterFromRaw(item, chapters.length + 1)
    if (!ch || seen.has(ch.itemId)) continue
    seen.add(ch.itemId)
    chapters.push(ch)
  }
  if (!chapters.length) throw new FqwebError('NOT_FOUND', '没有拿到目录')
  return bookFromRaw(infoRaw, chapters)
}

export async function fetchFanqieBookById(bookId: string): Promise<FanqieBookInfo> {
  return fqwebRequest('/catalog', { book_id: bookId }, 30_000, parseFqwebCatalog)
}

function cleanContent(raw: string, title: string): string {
  let text = raw.replace(/\r\n?/g, '\n')
  if (/<p[\s>]|<br\s*\/?>|<div[\s>]/i.test(text)) text = chapterHtmlToText(text)
  else text = decodeHtmlEntities(text)
  text = decodeFanqieText(text)
  text = text
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/^[\u3000\t ]+/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const lines = text.split('\n')
  if (title && lines[0]?.trim() === title.trim()) lines.shift()
  return lines.join('\n').trim()
}

/** /content：完整正文（含锁定章），纯文本或出版书的 HTML */
export function parseFqwebContent(raw: unknown): FqwebChapterContent {
  const inner = payload(raw)
  const contentRaw = str(inner.content)
  if (!contentRaw.trim()) throw new FqwebError('EMPTY', '这一章没有返回正文')
  const title = str(inner.title)
  const content = cleanContent(contentRaw, title)
  if (!content) throw new FqwebError('EMPTY', '这一章清洗后是空的')
  return {
    title,
    content,
    bookId: str(obj(inner.novel_data)?.book_id) || undefined,
    unknownGlyphs: hasUnknownFanqieGlyphs(content),
  }
}

export async function fetchFanqieChapterContent(itemId: string): Promise<FqwebChapterContent> {
  return fqwebRequest('/content', { item_id: itemId }, 12_000, parseFqwebContent)
}

/** 把章节链接解析成书籍：先查章节的 novel_data.book_id，再拉目录 */
export async function fetchFanqieBookByRef(ref: FanqieRef): Promise<FanqieBookInfo> {
  if (ref.kind === 'book') return fetchFanqieBookById(ref.id)
  if (ref.kind === 'chapter') {
    const content = await fetchFanqieChapterContent(ref.id)
    if (!content.bookId) throw new FqwebError('BAD_DATA', '章节里没有所属书籍 ID')
    return fetchFanqieBookById(content.bookId)
  }
  // 纯数字：先当书 ID 试目录，失败再当章节 ID
  try {
    return await fetchFanqieBookById(ref.id)
  } catch (e) {
    if (e instanceof FqwebError && e.code === 'RATE_LIMITED') throw e
    const content = await fetchFanqieChapterContent(ref.id)
    if (!content.bookId) throw new FqwebError('BAD_DATA', '章节里没有所属书籍 ID')
    return fetchFanqieBookById(content.bookId)
  }
}

/* ---------------- 搜索 ---------------- */

function extractSearchItems(raw: unknown): FanqieSearchItem[] {
  const out: FanqieSearchItem[] = []
  const seen = new Set<string>()
  const visit = (v: unknown, depth: number) => {
    if (!v || depth > 12) return
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    const o = obj(v)
    if (!o) return
    const id = str(o.book_id)
    const name = str(o.book_name)
    if (id && name && !seen.has(id)) {
      seen.add(id)
      const completed = num(o.creation_status) === 0
      out.push({
        bookId: id,
        title: decodeHtmlEntities(name),
        author: decodeHtmlEntities(str(o.author)) || undefined,
        cover: str(o.thumb_url) || str(o.detail_page_thumb_url) || undefined,
        abstract: decodeHtmlEntities(str(o.abstract)) || undefined,
        status: completed ? '已完结' : '连载中',
        wordCount: num(o.word_number),
        chapterCount: num(o.serial_count) || num(o.chapter_number),
      })
      return
    }
    for (const key of ['search_tabs', 'book_data', 'data', 'book_list', 'books', 'list']) {
      if (key in o) visit(o[key], depth + 1)
    }
  }
  visit(raw, 0)
  return out
}

export function parseFqwebSearch(raw: unknown): FanqieSearchItem[] {
  return extractSearchItems(raw)
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripBingTitle(s: string): string {
  return s
    .replace(/\s*[_|-]\s*番茄小说.*$/i, '')
    .replace(/\s*[-_]\s*fanqienovel.*$/i, '')
    .replace(/完整版.*$/i, '')
    .trim()
}

export function parseBingRss(xml: string): Array<{ bookId: string; title: string }> {
  const out: Array<{ bookId: string; title: string }> = []
  const seen = new Set<string>()
  const itemRe = /<item>([\s\S]*?)<\/item>/gi
  for (let m = itemRe.exec(xml); m; m = itemRe.exec(xml)) {
    const block = m[1]
    const title = stripBingTitle(decodeXml(/<title>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? ''))
    const link = decodeXml(/<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? '')
    const desc = decodeXml(/<description>([\s\S]*?)<\/description>/i.exec(block)?.[1] ?? '')
    const hit = /(?:fanqienovel\.com)\/page\/(\d{6,20})/i.exec(`${link} ${desc} ${block}`)
    if (!hit || seen.has(hit[1])) continue
    seen.add(hit[1])
    out.push({ bookId: hit[1], title: title || `番茄小说 ${hit[1]}` })
  }
  return out
}

export function fanqieWebSearchUrl(query: string): string {
  const url = new URL(BING_SEARCH)
  url.searchParams.set('q', `site:fanqienovel.com/page ${query}`)
  return url.toString()
}

async function searchBing(query: string): Promise<FanqieSearchItem[]> {
  const url = new URL(fanqieWebSearchUrl(query))
  url.searchParams.set('format', 'rss')
  const target = isNative() || isTauri() ? url.href : LOCAL_PROXY + encodeURIComponent(url.href)
  const xml = await fetchText(target, SEARCH_TIMEOUT, 'application/rss+xml, application/xml, text/xml, */*')
  if (!/<rss[\s>]/i.test(xml)) throw new FqwebError('BAD_DATA', '网页索引暂时不可用')
  return parseBingRss(xml)
}

async function searchFqweb(query: string): Promise<FanqieSearchItem[]> {
  return fqwebRequest('/search', { query, page: 1 }, SEARCH_TIMEOUT, (raw) => {
    const items = parseFqwebSearch(raw)
    if (!items.length) {
      // 接口出错时可能仍返回 HTTP 200。确认确实有结果列表（包括空列表）。
      const outer = obj(obj(raw)?.data)
      const code = outer?.code
      const hasData = obj(outer?.data) !== null || Array.isArray(outer?.data)
      if (!hasData || (code != null && !['0', '200'].includes(String(code)))) {
        throw new FqwebError('BAD_DATA', '书源搜索暂时不可用')
      }
    }
    return items
  })
}

const compact = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function rankSearchItems(query: string, items: FanqieSearchItem[]): FanqieSearchItem[] {
  const key = compact(query)
  const terms = query.split(/\s+/).map(compact).filter(Boolean)
  if (!key) return items
  const score = (item: FanqieSearchItem) => {
    const title = compact(item.title)
    const author = compact(item.author ?? '')
    if (title === key) return 5
    if (author === key || title.startsWith(key)) return 4
    if (title.includes(key) || author.includes(key)) return 3
    if (terms.every((term) => title.includes(term) || author.includes(term))) return 2
    return 0
  }
  return items.map((item) => ({ item, score: score(item) })).sort((a, b) => b.score - a.score).map(({ item }) => item)
}

const searchCache = new Map<string, { at: number; items: FanqieSearchItem[] }>()
const SEARCH_TTL = 10 * 60_000

/** 合并两个来源，保留书源元数据，并把更接近书名或作者的候选排在前面。 */
export async function searchFanqieBooks(query: string): Promise<FanqieSearchItem[]> {
  const keyword = query.normalize('NFKC').trim().replace(/^《(.*)》$/u, '$1').trim().replace(/\s+/g, ' ')
  if (!keyword) return []
  const key = keyword.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.items

  const sources = await Promise.allSettled([searchFqweb(keyword), searchBing(keyword)])
  if (sources.every((source) => source.status === 'rejected')) {
    const limited = sources.find((source) => source.status === 'rejected' && source.reason instanceof FqwebError && source.reason.code === 'RATE_LIMITED')
    if (limited?.status === 'rejected') throw limited.reason
    throw new FqwebError('UNAVAILABLE', '在线搜索暂时不可用')
  }
  const byId = new Map<string, FanqieSearchItem>()
  for (const source of sources) {
    if (source.status !== 'fulfilled') continue
    for (const item of source.value) {
      if (!byId.has(item.bookId)) byId.set(item.bookId, item)
    }
  }
  const items = rankSearchItems(keyword, [...byId.values()])
  if (items.length) searchCache.set(key, { at: Date.now(), items })
  return items
}
