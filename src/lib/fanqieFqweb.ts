import { isNative, isTauri } from './native'
import { BROWSER_UA, LOCAL_PROXY, httpText } from './http'
import type { FanqieBookInfo, FanqieChapterMeta, FanqieRef } from './fanqie'
import {
  chapterHtmlToText,
  decodeHtmlEntities,
  parseBookPage,
  parseChapterJson,
  parseChapterPage,
  parseDirectoryJson,
} from './fanqie'
import { decodeFanqieText, hasUnknownFanqieGlyphs } from './fanqieFont'

/**
 * 正文/目录优先来自公开的 FQWeb 节点（番茄 App 协议服务），失败时回退官网 SSR / 目录接口。
 * 公共节点可用性会变化，用户也可配置自定义 FQWeb 节点；搜索同时参考 FQWeb 与搜索引擎索引。
 */
export const FQWEB_BASES = [
  'https://fq-book.nat.netsite.cc:8043',
  'https://fq-book.netsite.cc',
] as const

const CUSTOM_NODE_KEY = 'kairos:fqweb-node-url'
const BING_SEARCH = 'https://cn.bing.com/search'
const FANQIE_SITE = 'https://fanqienovel.com'
const SEARCH_TIMEOUT = 5_000

export const FANQIE_WEB_CORS_HINT =
  '网页版受浏览器跨域限制，请使用 Kairos 桌面/安卓版，或在本机运行跨域代理 127.0.0.1:8787'

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
  aliases?: string[]
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

export interface FqwebNodeTestResult {
  ok: boolean
  base: string
  latencyMs: number
  message: string
}

/* ---------------- 自定义节点管理 ---------------- */

export function normalizeFqwebBase(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('请输入有效的 HTTP(S) 节点地址')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('节点地址仅支持 http 或 https')
  }
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/(?:catalog|content|search|info)\/?$/i, '').replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}

export function getCustomFqwebBase(): string {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOM_NODE_KEY) : null
    return raw ? normalizeFqwebBase(raw) : ''
  } catch {
    return ''
  }
}

export function setCustomFqwebBase(raw: string): string {
  const normalized = normalizeFqwebBase(raw)
  try {
    if (typeof localStorage !== 'undefined') {
      if (normalized) localStorage.setItem(CUSTOM_NODE_KEY, normalized)
      else localStorage.removeItem(CUSTOM_NODE_KEY)
    }
  } catch {
    /* ignore storage failures */
  }
  return normalized
}

export function getFqwebBases(): string[] {
  const custom = getCustomFqwebBase()
  if (!custom) return [...FQWEB_BASES]
  return [custom, ...FQWEB_BASES.filter((b) => b !== custom)]
}

/* ---------------- 基础请求与 URL 去重 ---------------- */

function chinaDate(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

/** 去重 URL 查询参数（防止重定向或拼接后出现重复 nt= 参数） */
export function dedupeQueryParams(rawUrl: string): string {
  const url = new URL(rawUrl)
  const deduped = new URLSearchParams()
  for (const [k, v] of url.searchParams.entries()) {
    deduped.set(k, v)
  }
  url.search = deduped.toString()
  return url.toString()
}

export function buildFqwebUrl(base: string, path: string, params?: Record<string, string | number>): string {
  const url = new URL(base)
  const cleanBasePath = url.pathname.replace(/\/+$/, '')
  const cleanPath = path.replace(/^\/+/, '')
  url.pathname = cleanPath ? `${cleanBasePath}/${cleanPath}` : cleanBasePath || '/'
  // 先去重（例如自定义节点或跳转前已附带 nt=），再按最新参数覆盖
  const merged = new URLSearchParams()
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'nt') merged.set(k, v)
  }
  for (const [k, v] of Object.entries(params ?? {})) merged.set(k, String(v))
  merged.set('nt', chinaDate())
  url.search = merged.toString()
  return url.toString()
}

function isWebCorsFailure(err: unknown): boolean {
  if (isNative() || isTauri()) return false
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /failed to fetch|networkerror|load failed|network request failed|cors/i.test(msg)
}

function checkStatus(status: number) {
  if (status === 429) throw new FqwebError('RATE_LIMITED', '书源请求过多，请稍后重试')
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
}

async function fetchText(
  url: string,
  timeoutMs: number,
  accept = 'application/json, text/plain, */*',
  proxyFallback = !url.startsWith(LOCAL_PROXY),
) {
  const target = dedupeQueryParams(url)
  const headers: Record<string, string> = isNative() ? { 'User-Agent': BROWSER_UA, Accept: accept } : { Accept: accept }
  const { body } = await httpText(target, {
    headers,
    timeoutMs,
    connectTimeoutMs: Math.min(timeoutMs, 5_000),
    proxyFallback,
    onStatus: checkStatus,
  })
  return body
}

let chapterBase = ''

async function fqwebRequest<T>(
  path: string,
  params: Record<string, string | number>,
  timeoutMs: number,
  parse: (raw: unknown) => T,
): Promise<T> {
  const allBases = getFqwebBases()
  const preferred = path === '/content' && chapterBase && allBases.includes(chapterBase) ? chapterBase : allBases[0]
  const bases = [preferred, ...allBases.filter((base) => base !== preferred)]
  let dataError: FqwebError | undefined
  let sawWebCors = false
  for (const base of bases) {
    try {
      const text = await fetchText(buildFqwebUrl(base, path, params), timeoutMs)
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
      } else if (isWebCorsFailure(e)) {
        sawWebCors = true
      }
    }
  }
  if (dataError) throw dataError
  if (sawWebCors) throw new FqwebError('UNAVAILABLE', FANQIE_WEB_CORS_HINT)
  throw new FqwebError('UNAVAILABLE', '书源暂时连不上')
}

/** 测试单个 FQWeb 节点连通性 */
export async function testFqwebNode(baseInput?: string): Promise<FqwebNodeTestResult> {
  const base = baseInput?.trim() ? normalizeFqwebBase(baseInput) : getFqwebBases()[0]
  const started = Date.now()
  try {
    const url = buildFqwebUrl(base, '/search', { query: '戏神', page: 1 })
    const text = await fetchText(url, 6_000)
    const raw = JSON.parse(text) as unknown
    const outer = obj(obj(raw)?.data)
    if (!outer) throw new Error('返回结构异常')
    if (String(outer.code) === '429') {
      return { ok: false, base, latencyMs: Date.now() - started, message: '节点触发限流（HTTP/Code 429）' }
    }
    return {
      ok: true,
      base,
      latencyMs: Date.now() - started,
      message: `节点可用 · ${Date.now() - started}ms`,
    }
  } catch (e) {
    const latencyMs = Date.now() - started
    const message = isWebCorsFailure(e)
      ? FANQIE_WEB_CORS_HINT
      : e instanceof Error
        ? e.message
        : '连接失败'
    return { ok: false, base, latencyMs, message }
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

/** FQWeb 统一外壳：{ data: { code:"0", data: {...}, message } } */
function payload(raw: unknown): Record<string, unknown> {
  const outer = obj(obj(raw)?.data)
  if (!outer) throw new FqwebError('BAD_DATA', '接口没有返回 data')
  const code = outer.code
  if (String(code) === '429') throw new FqwebError('RATE_LIMITED', '书源请求过多，请稍后重试')
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

async function fetchOfficialBookById(bookId: string): Promise<FanqieBookInfo> {
  const html = await fetchText(`${FANQIE_SITE}/page/${bookId}`, 15_000, 'text/html,*/*')
  const info = parseBookPage(html)
  if (!info.chapters.length) {
    try {
      const dirRaw = JSON.parse(
        await fetchText(`${FANQIE_SITE}/api/reader/directory/detail?bookId=${bookId}`, 15_000),
      ) as unknown
      const chapters = parseDirectoryJson(dirRaw)
      if (chapters.length) {
        info.chapters = chapters
        info.chapterCount = chapters.length
      }
    } catch {
      /* 保留已解析到的书籍元信息 */
    }
  }
  if (!info.chapters.length) throw new FqwebError('NOT_FOUND', '官网书籍页没有返回章节目录')
  return info
}

export async function fetchFanqieBookById(bookId: string): Promise<FanqieBookInfo> {
  try {
    return await fqwebRequest('/catalog', { book_id: bookId }, 30_000, parseFqwebCatalog)
  } catch (fqErr) {
    try {
      return await fetchOfficialBookById(bookId)
    } catch {
      throw fqErr
    }
  }
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

async function fetchOfficialChapterContent(itemId: string): Promise<FqwebChapterContent> {
  try {
    const jsonText = await fetchText(`${FANQIE_SITE}/api/reader/full?itemId=${itemId}`, 12_000)
    const parsed = parseChapterJson(JSON.parse(jsonText))
    if (parsed && !parsed.truncated && parsed.content.trim()) {
      return {
        title: parsed.title,
        content: parsed.content,
        bookId: parsed.bookId,
        unknownGlyphs: parsed.unknownGlyphs,
      }
    }
  } catch {
    /* 继续回退到 SSR 阅读页 */
  }
  const html = await fetchText(`${FANQIE_SITE}/reader/${itemId}`, 12_000, 'text/html,*/*')
  const pageData = parseChapterPage(html)
  if (pageData.truncated) {
    throw new FqwebError('EMPTY', '该章节在官网仅提供试读片段，且 FQWeb 节点暂不可用')
  }
  if (!pageData.content.trim()) {
    throw new FqwebError('EMPTY', '官网章节正文为空')
  }
  return {
    title: pageData.title,
    content: pageData.content,
    bookId: pageData.bookId,
    unknownGlyphs: pageData.unknownGlyphs,
  }
}

export async function fetchFanqieChapterContent(itemId: string): Promise<FqwebChapterContent> {
  try {
    return await fqwebRequest('/content', { item_id: itemId }, 12_000, parseFqwebContent)
  } catch (fqErr) {
    if (fqErr instanceof FqwebError && fqErr.code === 'RATE_LIMITED') throw fqErr
    try {
      return await fetchOfficialChapterContent(itemId)
    } catch (officialErr) {
      if (officialErr instanceof FqwebError && officialErr.code === 'EMPTY') throw officialErr
      throw fqErr
    }
  }
}

/** 把章节链接解析成书籍：先查章节的 novel_data.book_id，再拉目录 */
export async function fetchFanqieBookByRef(ref: FanqieRef): Promise<FanqieBookInfo> {
  if (ref.kind === 'book') return fetchFanqieBookById(ref.id)
  if (ref.kind === 'topic') {
    const item = await fetchTopicBook(ref.id)
    if (!item) throw new FqwebError('NOT_FOUND', '这个番茄话题没有关联一部明确的作品')
    return fetchFanqieBookById(item.bookId)
  }
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
  return decodeHtmlEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

function stripIndexedTitle(s: string): string {
  return s
    .replace(/\s*[_|-]\s*番茄小说.*$/i, '')
    .replace(/\s*[-_]\s*fanqienovel.*$/i, '')
    .replace(/完整版.*$/i, '')
    .trim()
}

function parseBingLinks(xml: string, page: 'page' | 'author-page' | 'keyword'): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = []
  const seen = new Set<string>()
  const target = new RegExp(`https?://(?:www\\.)?fanqienovel\\.com/${page}/(\\d{6,20})(?!\\d)`, 'i')
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]
    const title = decodeXml(/<title>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? '')
    const link = decodeXml(/<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? '')
    const desc = decodeXml(/<description>([\s\S]*?)<\/description>/i.exec(block)?.[1] ?? '')
    const hit = target.exec(`${link} ${desc} ${block}`)
    if (!hit || seen.has(hit[1])) continue
    seen.add(hit[1])
    out.push({ id: hit[1], title })
  }
  return out
}

export function parseBingRss(xml: string): Array<{ bookId: string; title: string }> {
  return parseBingLinks(xml, 'page').map(({ id, title }) => ({ bookId: id, title: stripIndexedTitle(title) || `番茄小说 ${id}` }))
}

export function fanqieWebSearchUrl(query: string): string {
  const url = new URL(BING_SEARCH)
  url.searchParams.set('q', `site:fanqienovel.com/page ${query}`)
  return url.toString()
}

async function fetchBingRss(url: URL): Promise<string> {
  url.searchParams.set('format', 'rss')
  const target = isNative() || isTauri() ? url.href : LOCAL_PROXY + encodeURIComponent(url.href)
  const xml = await fetchText(target, SEARCH_TIMEOUT, 'application/rss+xml, application/xml, text/xml, */*', false)
  if (!/<rss[\s>]/i.test(xml)) throw new FqwebError('BAD_DATA', '网页索引暂时不可用')
  return xml
}

async function searchBing(query: string): Promise<FanqieSearchItem[]> {
  return parseBingRss(await fetchBingRss(new URL(fanqieWebSearchUrl(query))))
}

const titleText = (html: string) => decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).trim()

function topicTitle(title: string): string {
  return titleText(title).replace(/\s*[-_｜|]\s*番茄小说(?:官网)?\s*$/u, '').replace(/\s*相关帖子\s*$/u, '').trim()
}

function topicMatch(query: string, title: string): number {
  const key = compact(query)
  const alias = compact(title)
  if (key && key === alias) return 2
  return key.length >= 4 && alias.includes(key) ? 1 : 0
}

async function fetchTopicBook(id: string): Promise<FanqieSearchItem | null> {
  if (!/^\d{6,20}$/.test(id)) return null
  const url = `${FANQIE_SITE}/keyword/${id}`
  const html = await fetchText(url, SEARCH_TIMEOUT, 'text/html')
  const alias = topicTitle(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const detail = /<div\b[^>]*\bclass=["'][^"']*\bbook-detail\b[^"']*["'][^>]*>/i.exec(html)
  if (!detail) return null
  // 话题页的「作品详情」有明确关联的书。帖子和推荐列表里的链接不是该别名的依据。
  const card = html.slice(detail.index, detail.index + 12_000)
  const book = /<a\b(?=[^>]*\bclass=["'][^"']*\bbook-title\b[^"']*["'])[^>]*\bhref=["'](?:https:\/\/(?:www\.)?fanqienovel\.com)?\/page\/(\d{6,20})(?:[/?#][^"']*)?["'][^>]*>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(card)
  if (!book) return null
  const title = decodeFanqieText(titleText(book[2]))
  if (!title) return null
  const author = /<div\b[^>]*\bclass=["']author["'][^>]*>([\s\S]*?)<\/div>/i.exec(card.slice(book.index + book[0].length))?.[1]
  return {
    bookId: book[1], title, author: author ? decodeFanqieText(titleText(author)).replace(/\s*[/／]\s*著$/u, '') : undefined,
    aliases: alias && compact(alias) !== compact(title) ? [alias] : undefined,
  }
}

async function searchTopicBooks(query: string): Promise<FanqieSearchItem[]> {
  if (compact(query).length < 4) return []
  const terms = query.replace(/^[^:：]{1,12}[:：]/u, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (!terms) return []
  const url = new URL(BING_SEARCH)
  url.searchParams.set('q', `site:fanqienovel.com/keyword ${terms}`)
  const hits = parseBingLinks(await fetchBingRss(url), 'keyword')
  const candidates = hits.map(({ id, title }) => ({ id, match: topicMatch(query, topicTitle(title)) }))
    .filter(({ match }) => match > 0).sort((a, b) => b.match - a.match).slice(0, 2)
  const books = await Promise.allSettled(candidates.map(({ id }) => fetchTopicBook(id)))
  return books.flatMap((book) => {
    if (book.status !== 'fulfilled' || !book.value) return []
    const item = book.value
    return [item.title, ...(item.aliases ?? [])].some((title) => topicMatch(query, title) > 0) ? [item] : []
  })
}

async function searchSoBooks(query: string): Promise<FanqieSearchItem[]> {
  const url = new URL('https://www.so.com/s')
  url.searchParams.set('q', `site:fanqienovel.com ${query}`)
  const html = await fetchText(url.href, SEARCH_TIMEOUT, 'text/html')
  const links = html.matchAll(/<a\b[^>]*\bdata-mdurl=["']https?:\/\/(?:www\.)?fanqienovel\.com\/page\/(\d{6,20})(?:[/?#][^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi)
  const items = Array.from(links, ([, bookId, title]) => ({ bookId, title: stripIndexedTitle(titleText(title)) }))
  return rankFanqieSearchItems(query, items, true)
}

async function searchAuthorBooks(query: string): Promise<FanqieSearchItem[]> {
  const firstTerm = query.split(/\s+/, 1)[0]
  const authorKey = compact(firstTerm)
  if (authorKey.length < 2) return []
  const url = new URL(BING_SEARCH)
  url.searchParams.set('q', `site:fanqienovel.com/author-page ${firstTerm}`)
  const xml = await fetchBingRss(url)
  const authors = parseBingLinks(xml, 'author-page').map(({ id, title }) => ({
    id, name: stripIndexedTitle(title.split(/\s*[_｜|]\s*代表作/u, 1)[0]),
  }))
  const match = authors.find(({ name }) => compact(name) === authorKey)
    ?? authors.find(({ name }) => compact(name).startsWith(authorKey))
  if (!match) return []
  const html = await fetchText(`${FANQIE_SITE}/author-page/${match.id}`, SEARCH_TIMEOUT, 'text/html')
  const cards = html.matchAll(/<h2\b[^>]*>\s*<a\b[^>]*\bhref=["']\/page\/(\d{6,20})["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi)
  const items = Array.from(cards, ([, bookId, title]) => ({
    bookId, title: decodeFanqieText(titleText(title)), author: match.name,
  }))
  return rankFanqieSearchItems(query, items, true)
}

async function searchFqweb(query: string): Promise<FanqieSearchItem[]> {
  return fqwebRequest('/search', { query, page: 1 }, 2_500, (raw) => {
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

function searchScore(query: string): (item: FanqieSearchItem) => number {
  const key = compact(query)
  const terms = query.split(/\s+/).map(compact).filter(Boolean)
  return (item) => {
    if (!key || !item.title) return 0
    const titles = [item.title, ...(item.aliases ?? [])].map(compact)
    const author = compact(item.author ?? '')
    if (titles.includes(key)) return 5
    if (author === key || titles.some((title) => title.startsWith(key))) return 4
    if (author.includes(key) || titles.some((title) => title.includes(key))) return 3
    if (terms.every((term) => author.includes(term) || titles.some((title) => title.includes(term)))) return 2
    return 0
  }
}

export function rankFanqieSearchItems(query: string, items: FanqieSearchItem[], onlyMatches = false): FanqieSearchItem[] {
  const score = searchScore(query)
  const ranked = items.map((item) => ({ item, score: score(item) }))
  return (onlyMatches ? ranked.filter((entry) => entry.score > 0) : ranked)
    .sort((a, b) => b.score - a.score).map(({ item }) => item)
}

const searchCache = new Map<string, { at: number; items: FanqieSearchItem[] }>()
const SEARCH_TTL = 10 * 60_000

function mergeSearchItem(items: Map<string, FanqieSearchItem>, item: FanqieSearchItem) {
  const previous = items.get(item.bookId)
  if (!previous) items.set(item.bookId, item)
  else if (item.aliases?.length) {
    items.set(item.bookId, {
      ...previous, title: item.title, author: item.author ?? previous.author,
      aliases: [...new Set([...(previous.aliases ?? []), ...item.aliases])],
    })
  }
}

/** 常用来源漏掉书名或作者时，再查询补充索引和番茄作者页。 */
export async function searchFanqieBooks(
  query: string,
  onResults?: (items: FanqieSearchItem[]) => void,
): Promise<FanqieSearchItem[]> {
  const keyword = query.normalize('NFKC').trim().replace(/^《(.*)》$/u, '$1').trim().replace(/\s+/g, ' ')
  if (!keyword) return []
  const key = keyword.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.items

  const score = searchScore(keyword)
  const preview = new Map<string, FanqieSearchItem>()
  const collect = (requests: Promise<FanqieSearchItem[]>[]) => Promise.allSettled(requests.map(async (request) => {
    const found = await request
    if (onResults && found.some((item) => score(item) > 0)) {
      for (const item of found) mergeSearchItem(preview, item)
      onResults(rankFanqieSearchItems(keyword, [...preview.values()], true))
    }
    return found
  }))
  const nativeSearch = isNative() || isTauri()
  const shortQuery = nativeSearch && compact(keyword).length === 2
  const primary = [searchFqweb(keyword), searchBing(keyword)]
  if (shortQuery) primary.push(searchSoBooks(keyword))
  const sources = await collect(primary)
  const primaryResults = sources.flatMap((source) => source.status === 'fulfilled' ? source.value : [])
  const hasMatch = primaryResults.some((item) => score(item) > 0)
  const hasExact = primaryResults.some((item) => score(item) === 5)
  if (nativeSearch && (!hasMatch || (keyword.includes(':') && !hasExact))) {
    const fallback = [searchTopicBooks(keyword)]
    if (!hasMatch) {
      fallback.push(searchAuthorBooks(keyword))
      if (!shortQuery) fallback.unshift(searchSoBooks(keyword))
    }
    sources.push(...await collect(fallback))
  }
  if (sources.every((source) => source.status === 'rejected')) {
    const limited = sources.find((source) => source.status === 'rejected' && source.reason instanceof FqwebError && source.reason.code === 'RATE_LIMITED')
    if (limited?.status === 'rejected') throw limited.reason
    const corsErr = sources.find((source) => source.status === 'rejected' && (
      isWebCorsFailure(source.reason) || (source.reason instanceof FqwebError && source.reason.message === FANQIE_WEB_CORS_HINT)
    ))
    if (corsErr) throw new FqwebError('UNAVAILABLE', FANQIE_WEB_CORS_HINT)
    throw new FqwebError('UNAVAILABLE', '在线搜索暂时不可用')
  }
  const byId = new Map<string, FanqieSearchItem>()
  for (const source of sources) {
    if (source.status !== 'fulfilled') continue
    for (const item of source.value) mergeSearchItem(byId, item)
  }
  const items = rankFanqieSearchItems(keyword, [...byId.values()])
  if (items.some((item) => score(item) > 0)) searchCache.set(key, { at: Date.now(), items })
  return items
}
