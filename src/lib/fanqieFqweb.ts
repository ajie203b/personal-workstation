import { CapacitorHttp } from '@capacitor/core'
import { isNative, isTauri } from './native'
import type { FanqieBookInfo, FanqieChapterMeta, FanqieRef } from './fanqie'
import { chapterHtmlToText, decodeHtmlEntities } from './fanqie'
import { decodeFanqieText, hasUnknownFanqieGlyphs } from './fanqieFont'

/**
 * 正文/目录来自公开的 FQWeb 节点（番茄 App 协议服务）。
 * 它不需要登录，info/catalog/content 都带 CORS；搜索结果接口在公共节点上经常报错，
 * 所以搜索先试 FQWeb /search，失败再用 Bing RSS 找 fanqienovel.com/page 的书籍 ID。
 */
const FQWEB_BASES = [
  'https://fq-book.nat.netsite.cc:8043',
  'https://fq-book.netsite.cc',
]
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const LOCAL_PROXY = 'http://127.0.0.1:8787/?url='
const BING_RSS = 'https://cn.bing.com/search?format=rss&q='

export type FqwebErrorCode =
  | 'UNAVAILABLE'
  | 'BAD_DATA'
  | 'EMPTY'
  | 'NOT_FOUND'
  | 'SEARCH_NEEDS_PROXY'

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

async function webFetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: accept },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    window.clearTimeout(timer)
  }
}

async function nativeFetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const res = await CapacitorHttp.get({
    url,
    headers: { 'User-Agent': DESKTOP_UA, Accept: accept },
    responseType: 'text',
    connectTimeout: 15_000,
    readTimeout: timeoutMs,
  })
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
}

/** 桌面版（Tauri）：由 Rust 发请求，不吃跨域限制，Bing 搜索也不用本机代理 */
async function tauriFetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await tauriFetch(url, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: accept },
      connectTimeout: 15_000,
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    window.clearTimeout(timer)
  }
}

/** 是否能绕开浏览器跨域（安卓原生壳 / Windows 桌面壳） */
function canBypassCors(): boolean {
  return isNative() || isTauri()
}

async function fetchText(url: string, timeoutMs: number, accept = 'application/json, text/plain, */*') {
  if (isNative()) return nativeFetchText(url, timeoutMs, accept)
  if (isTauri()) return tauriFetchText(url, timeoutMs, accept)
  return webFetchText(url, timeoutMs, accept)
}

/** 依次试“直连端口”和“Cloudflare 前置域名”；两个地址都挂了才算不可用 */
async function fqwebFetchText(
  path: string,
  params?: Record<string, string | number>,
  timeoutMs = 25_000,
): Promise<string> {
  let last: unknown
  for (const base of FQWEB_BASES) {
    const url = buildUrl(base, path, params)
    try {
      const text = await fetchText(url, timeoutMs)
      if (!text.trim()) throw new Error('空响应')
      return text
    } catch (e) {
      last = e
      await sleep(500)
    }
  }
  throw new FqwebError(
    'UNAVAILABLE',
    `正文接口暂时连不上${last instanceof Error ? `（${last.message}）` : ''}`,
  )
}

async function fqwebJson<T>(
  path: string,
  params?: Record<string, string | number>,
  timeoutMs = 25_000,
): Promise<T> {
  const text = await fqwebFetchText(path, params, timeoutMs)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new FqwebError('BAD_DATA', '正文接口返回的不是 JSON')
  }
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

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

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

/** /info：搜索结果/详情页用，不返回目录 */
export function parseFqwebInfo(raw: unknown): FanqieBookInfo {
  return bookFromRaw(payload(raw))
}

export async function fetchFanqieBookInfo(bookId: string): Promise<FanqieBookInfo> {
  const json = await fqwebJson<unknown>('/info', { book_id: bookId }, 24_000)
  return parseFqwebInfo(json)
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
  const json = await fqwebJson<unknown>('/catalog', { book_id: bookId }, 45_000)
  return parseFqwebCatalog(json)
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
  const json = await fqwebJson<unknown>('/content', { item_id: itemId }, 22_000)
  return parseFqwebContent(json)
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
  } catch {
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

let fqwebSearchBrokenUntil = 0

async function searchFqweb(query: string): Promise<FanqieSearchItem[]> {
  if (Date.now() < fqwebSearchBrokenUntil) throw new FqwebError('BAD_DATA', 'FQWeb 搜索暂不可用')
  try {
    const json = await fqwebJson<unknown>('/search', { query, page: 1 }, 6_000)
    const items = parseFqwebSearch(json)
    if (!items.length) throw new FqwebError('EMPTY', 'FQWeb 搜索没有结果')
    return items
  } catch (e) {
    fqwebSearchBrokenUntil = Date.now() + 5 * 60_000
    throw e
  }
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

async function fetchBingRss(query: string): Promise<string> {
  const url = BING_RSS + encodeURIComponent(`site:fanqienovel.com/page ${query}`)
  const accept = 'application/rss+xml, application/xml, text/xml, */*'
  if (canBypassCors()) return fetchText(url, 20_000, accept)
  // Bing 不返回 CORS 头，网页版只能走本机代理；下载正文不需要代理
  try {
    return await webFetchText(LOCAL_PROXY + encodeURIComponent(url), 20_000, accept)
  } catch {
    throw new FqwebError(
      'SEARCH_NEEDS_PROXY',
      '网页版搜索需要本机代理：先运行 node scripts/fanqie-proxy.mjs（安卓 App 不需要）',
    )
  }
}

async function searchBing(query: string): Promise<FanqieSearchItem[]> {
  let xml = ''
  try {
    xml = await fetchBingRss(query)
  } catch (e) {
    if (e instanceof FqwebError) throw e
    throw new FqwebError('UNAVAILABLE', '搜索服务暂时不可用')
  }
  let hits = parseBingRss(xml)
  // 站点限定没命中时放宽一次（有些书名只在普通结果里出现）
  if (!hits.length) {
    const url = BING_RSS + encodeURIComponent(`site:fanqienovel.com ${query}`)
    try {
      const retry = canBypassCors()
        ? await fetchText(url, 20_000, 'application/rss+xml, text/xml, */*')
        : await webFetchText(LOCAL_PROXY + encodeURIComponent(url), 20_000, 'application/rss+xml, text/xml, */*')
      hits = parseBingRss(retry)
    } catch {
      /* 保持空结果 */
    }
  }
  if (!hits.length) throw new FqwebError('NOT_FOUND', '没搜到这本书')

  const top = hits.slice(0, 4)
  const enriched = await Promise.all(
    top.map(async (hit) => {
      try {
        const info = await fetchFanqieBookInfo(hit.bookId)
        return {
          bookId: hit.bookId,
          title: info.title,
          author: info.author,
          cover: info.cover,
          abstract: info.abstract,
          status: info.status,
          wordCount: info.wordCount,
          chapterCount: info.chapterCount,
        } satisfies FanqieSearchItem
      } catch {
        return { bookId: hit.bookId, title: hit.title } satisfies FanqieSearchItem
      }
    }),
  )
  // 保留 Bing 里其余候选，避免前 4 个取不到信息就看不到书
  const rest = hits.slice(4).map((h) => ({ bookId: h.bookId, title: h.title }))
  return [...enriched, ...rest]
}

const searchCache = new Map<string, { at: number; items: FanqieSearchItem[] }>()
const SEARCH_TTL = 10 * 60_000

/** 搜书名：FQWeb 搜索（当前公共节点常报错）→ Bing RSS → 用 FQWeb /info 补全 */
export async function searchFanqieBooks(query: string): Promise<FanqieSearchItem[]> {
  const key = query.trim().toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.items

  let items: FanqieSearchItem[] = []
  // FQWeb 的 /search 在公共节点上经常报错，而且网页端 CORS 头是 null；
  // 网页直接走 Bing，安卓上才先试一下 FQWeb（它不受 CORS 限制）。
  if (canBypassCors()) {
    try {
      items = await searchFqweb(query)
    } catch {
      items = await searchBing(query)
    }
  } else {
    items = await searchBing(query)
  }
  if (!items.length) throw new FqwebError('NOT_FOUND', '没搜到这本书')
  searchCache.set(key, { at: Date.now(), items })
  return items
}
