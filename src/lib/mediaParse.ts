import { BROWSER_UA, httpBytes, httpJson, httpText } from './http'
import { isNative, isTauri } from './native'
import { sanitizeFilename } from './fanqieExport'
import { downloadUrlToDownloads, saveBlob } from './saveFile'

/**
 * 无水印解析（抖音 / B站）。
 *
 * 两个平台的取流配方都来自 GitHub 上 2026-10 仍在维护的开源实现，并在本机实测过：
 * - 抖音：移动端 feed 协议 `/aweme/v1/feed/`（免签名、免 Cookie）——2026-08 起
 *   a_bogus 纯签名被 Argus 网关拦死后，这是唯一免指纹的通道；字节只对机房 IP
 *   软限流（推荐流顶替目标作品），手机家宽不受影响。配方参考
 *   Student414/douyin-cf-downloader（MIT，转译自 jiji262/douyin-downloader）。
 * - B站：官方 web 接口 `x/web-interface/view` + `x/player/playurl`，
 *   fnval=1 取 durl 单文件 MP4（免 ffmpeg 合流；未登录上限 720P），fnval=16 可按需取纯音频 M4A。
 *
 * 仅供个人离线收藏，请支持原作者。
 */

export type MediaPlatform = 'douyin' | 'bilibili'

export interface ParsedAsset {
  kind: 'video' | 'image' | 'audio'
  url: string
  /** 展示用标签：画质档位或序号 */
  label: string
  filename: string
  page?: number
}

export interface BiliPageInfo {
  page: number
  cid: number
  part: string
  duration?: number
}

export interface ParsedMedia {
  platform: MediaPlatform
  title: string
  author: string
  cover?: string
  assets: ParsedAsset[]
  /** 提示语（画质说明、分P 说明等） */
  note?: string
  bvid?: string
  aid?: number
  currentPage?: number
  pages?: BiliPageInfo[]
}

export interface ParseShareOptions {
  signal?: AbortSignal
  /** B站指定分 P（从 1 开始） */
  page?: number
  /** B站一次拉取全部分 P */
  allPages?: boolean
  /** B站仅提取纯音频（DASH .m4a） */
  audioOnly?: boolean
}

/* ---------------- 错误诊断、取消控制与 HTTP ---------------- */

const DESKTOP_UA = BROWSER_UA

export const WEB_CORS_HINT =
  '网页版受浏览器跨域限制，请使用 Kairos 桌面/安卓版，或在本机运行跨域代理 127.0.0.1:8787'

function createAbortError(): Error {
  const err = new Error('已取消')
  err.name = 'AbortError'
  return err
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

export function isWebCorsBlocked(err: unknown): boolean {
  if (isNative() || isTauri()) return false
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /failed to fetch|networkerror|load failed|network request failed|cors/i.test(msg)
}

export function formatMediaError(err: unknown, fallback = '网络错误'): string {
  if (isAbortError(err)) return '已取消'
  if (isWebCorsBlocked(err)) return WEB_CORS_HINT
  return err instanceof Error ? err.message : fallback
}

function toHttps(url: string): string {
  return url ? url.replace(/^http:\/\//i, 'https://') : ''
}

async function httpGetText(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ body: string; finalUrl: string }> {
  throwIfAborted(signal)
  const { body, finalUrl } = await raceAbort(
    httpText(url, { headers, timeoutMs: 30_000, proxyFallback: true }),
    signal,
  )
  return { body, finalUrl }
}

async function httpGetJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  throwIfAborted(signal)
  return raceAbort(httpJson(url, { headers, timeoutMs: 30_000, proxyFallback: true }), signal)
}

/** 媒体二进制：原生走 CapacitorHttp / Tauri（绕 CORS），网页走 fetch + 本地代理回退 */
async function httpGetBlob(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal)
  const { bytes } = await raceAbort(
    httpBytes(url, { headers, timeoutMs: 120_000, proxyFallback: true }),
    signal,
  )
  return new Blob([bytes])
}

/* ---------------- 公共：链接提取与平台识别 ---------------- */

/** 从分享文案里取第一条链接（结尾的中文标点/括号不算链接） */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"'，。；！？、）)】]+/i.exec(text)
  return m ? m[0] : null
}

function extractBareDomainUrl(text: string): string | null {
  const m =
    /(?:^|[\s，。；！？、：（(【])((?:www\.|v\.|m\.)?(?:douyin|iesdouyin|amemv)\.com\/[^\s<>"'，。；！？、）)】]+|(?:www\.|m\.)?bilibili\.com\/[^\s<>"'，。；！？、）)】]+|(?:b23\.tv|bili2233\.cn)\/[^\s<>"'，。；！？、）)】]+)/i.exec(
      text,
    )
  return m ? `https://${m[1]}` : null
}

export function detectPlatform(url: string): MediaPlatform | null {
  const host = url.toLowerCase()
  if (/(^|\/\/|\.)((v|www)\.)?(douyin|iesdouyin|amemv)\.com/.test(host) || host.includes('douyinvod.com')) return 'douyin'
  if (
    /(^|\/\/|\.)((www|m)\.)?bilibili\.com/.test(host) ||
    host.includes('b23.tv') ||
    host.includes('bili2233.cn')
  ) {
    return 'bilibili'
  }
  return null
}

/* ---------------- 抖音 ---------------- */

/** 各种形态的抖音链接 → 19 位作品 ID */
export function extractDouyinId(url: string): string | null {
  const patterns = [
    /\/(?:share\/)?(?:video|slides|note)\/(\d{6,})/,
    /[?&]modal_id=(\d{6,})/,
    /[?&]aweme_id=(\d{6,})/,
  ]
  for (const re of patterns) {
    const m = re.exec(url)
    if (m) return m[1]
  }
  // 裸 ID（App 分享文案里偶尔只有数字）
  const bare = /^\d{6,}$/.test(url.trim()) ? url.trim() : null
  return bare
}

interface DouyinProfile {
  brand: string
  type: string
  vc: string
  os: string
  osApi: string
  ua: string
}

/** 双设备档案：新档案能拿到更高档位，旧档案兜底（配方来自 douyin-cf-downloader） */
const DOUYIN_PROFILES: DouyinProfile[] = [
  {
    brand: 'HUAWEI', type: 'ALN-AL00', vc: '270000', os: '14', osApi: '34',
    ua: 'com.ss.android.ugc.aweme/270000 (Linux; U; Android 14; zh_CN; ALN-AL00; Build/HUAWEIALN-AL00; Cronet/TTNetVersion:2024-01-22)',
  },
  {
    brand: 'HUAWEI', type: 'HWI-AL00', vc: '250201', os: '9', osApi: '28',
    ua: 'com.ss.android.ugc.aweme/250201 (Linux; U; Android 9; zh_CN; HWI-AL00; Build/HUAWEIHWI-AL00; Cronet/TTNetVersion:2023-08-11)',
  },
]
const DOUYIN_BASES = [
  'https://api5-normal-c-hl.amemv.com',
  'https://api5-normal-lf.amemv.com',
  'https://aweme-eagle.snssdk.com',
]

function rand19(): string {
  // 逐位生成 19 位十进制数字，避开 IEEE-754 双精度整数（2^53 ≈ 9e15）尾数截断为 0 的精度损失
  let out = String(1 + Math.floor(Math.random() * 9))
  for (let i = 1; i < 19; i++) out += String(Math.floor(Math.random() * 10))
  return out
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function firstUrl(v: unknown): string {
  const list = obj(v).url_list
  return Array.isArray(list) && typeof list[0] === 'string' ? list[0] : ''
}

/** 画质档位：gear_name 里的三位数（adapt_lowest_720_1 → 720）；兜底取短边 */
function gearTier(gearName: unknown, w: unknown, h: unknown): number {
  const m = /(\d{3,4})/.exec(str(gearName))
  if (m) return Number(m[1])
  const wn = typeof w === 'number' ? w : 0
  const hn = typeof h === 'number' ? h : 0
  return Math.min(wn, hn) || 0
}

/** feed 命中的 item → 标题/作者/素材（视频取最高档；图集逐张 + 背景音乐） */
export function douyinMediaFromItem(item: Record<string, unknown>, awemeId: string): ParsedMedia {
  const title = str(item.desc) || `抖音作品 ${awemeId}`
  const author = str(obj(item.author).nickname)
  const video = obj(item.video)

  // 视频：bit_rate 里挑档位最高的 play 地址；没有 bit_rate 退回 play_addr
  const assets: ParsedAsset[] = []
  let best: { url: string; tier: number } | null = null
  const bitRates = Array.isArray(video.bit_rate) ? (video.bit_rate as unknown[]) : []
  for (const raw of bitRates) {
    const b = obj(raw)
    const url = firstUrl(b.play_addr)
    if (!url) continue
    const tier = gearTier(b.gear_name, obj(b.play_addr).width, obj(b.play_addr).height)
    if (!best || tier > best.tier) best = { url, tier }
  }
  const fallbackPlay = firstUrl(video.play_addr) || firstUrl(video.download_addr)
  const playUrl = best?.url || fallbackPlay
  if (playUrl) {
    assets.push({
      kind: 'video',
      url: playUrl,
      label: best?.tier ? `${best.tier}P` : '视频',
      filename: '',
    })
  }

  // 图集：image_post_info.images（origin 优先，其次 display_images；不碰带水印的两张）
  // → 老结构 images[].url_list
  const imageList: string[] = []
  const postImgs = obj(item.image_post_info).images
  if (Array.isArray(postImgs)) {
    for (const raw of postImgs) {
      const img = obj(raw)
      const display = Array.isArray(img.display_images) ? (img.display_images as unknown[]) : []
      const candidates = [
        firstUrl(img.origin),
        ...display.map((d) => firstUrl(d)),
        firstUrl(img),
      ].filter(Boolean)
      if (candidates[0]) imageList.push(candidates[0])
    }
  }
  if (!imageList.length && Array.isArray(item.images)) {
    for (const raw of item.images as unknown[]) {
      const url = firstUrl(raw)
      if (url) imageList.push(url)
    }
  }
  imageList.forEach((url, i) => {
    assets.push({ kind: 'image', url, label: `图 ${i + 1}`, filename: '' })
  })

  // 图集附带背景音乐时一起提供音频下载
  if (imageList.length > 0) {
    const music = obj(item.music)
    const musicUrl = firstUrl(music.play_url) || str(obj(music.play_url).uri)
    if (/^https?:\/\//i.test(musicUrl)) {
      const musicTitle = str(music.title)
      assets.push({
        kind: 'audio',
        url: toHttps(musicUrl),
        label: musicTitle ? `背景音乐 · ${musicTitle}` : '背景音乐',
        filename: '',
      })
    }
  }

  const rawCover = firstUrl(video.cover) || firstUrl(video.origin_cover) || imageList[0] || ''
  const cover = toHttps(rawCover) || undefined
  return {
    platform: 'douyin',
    title,
    author,
    cover,
    assets,
    note: assets.some((a) => a.kind === 'video')
      ? '清晰度来自作品源（feed 协议常见 720P 档）'
      : undefined,
  }
}

export async function parseDouyin(input: string, opts?: { signal?: AbortSignal }): Promise<ParsedMedia> {
  const signal = opts?.signal
  const url = extractUrl(input) ?? extractBareDomainUrl(input) ?? input.trim()
  if (!url) throw new Error('没找到链接，粘贴整段分享文案即可')

  // 短链先跟随重定向拿作品 ID；长链/裸 ID 直接提取
  let awemeId = extractDouyinId(url)
  if (!awemeId) {
    try {
      const { finalUrl } = await httpGetText(url, { 'User-Agent': DESKTOP_UA, Accept: 'text/html,*/*' }, signal)
      awemeId = extractDouyinId(finalUrl) ?? extractDouyinId(decodeURIComponent(finalUrl))
    } catch (e) {
      if (isAbortError(e)) throw e
      throw new Error(formatMediaError(e, '短链解析失败'))
    }
  }
  if (!awemeId) throw new Error('识别不出抖音作品 ID，换个分享链接试试')

  // feed 协议：3 host × 2 档案 × 2 轮，命中 aweme_list 里的目标作品为止
  let lastError = '所有节点都没有返回这部作品'
  for (let round = 0; round < 2; round++) {
    for (const prof of DOUYIN_PROFILES) {
      for (const base of DOUYIN_BASES) {
        throwIfAborted(signal)
        const qs = new URLSearchParams({
          aweme_id: awemeId,
          type: '0',
          count: '1',
          iid: rand19(),
          device_id: rand19(),
          os_api: prof.osApi,
          app_type: 'normal',
          os_version: prof.os,
          device_platform: 'android',
          device_brand: prof.brand,
          device_type: prof.type,
          version_code: prof.vc,
          channel: 'huawei',
          aid: '1128',
        })
        try {
          const data = obj(
            await httpGetJson(
              `${base}/aweme/v1/feed/?${qs}`,
              { 'User-Agent': prof.ua, Accept: 'application/json' },
              signal,
            ),
          )
          const list = Array.isArray(data.aweme_list) ? (data.aweme_list as unknown[]) : []
          const hit = list.map(obj).find((it) => str(it.aweme_id) === awemeId)
          if (hit) return douyinMediaFromItem(hit, awemeId)
          // code=0 但列表里没有目标 = 软限流（推荐流顶替），换节点继续
          lastError = '节点返回了推荐流而不是这部作品（被软限流），稍后再试'
        } catch (e) {
          if (isAbortError(e)) throw e
          if (isWebCorsBlocked(e)) throw new Error(WEB_CORS_HINT)
          lastError = formatMediaError(e, '请求失败')
        }
      }
    }
  }
  throw new Error(`抖音解析失败：${lastError}`)
}

/* ---------------- B站 ---------------- */

export type BiliRef =
  | { bvid: string; aid?: never; page: number }
  | { aid: number; bvid?: never; page: number }

/** B站长链 / b23.tv / bili2233.cn 短链 / 纯 BV 号 / av 号 → BV/av + 分P */
export function extractBiliRef(url: string): BiliRef | null {
  const p = /[?&]p=(\d+)/.exec(url)
  const page = p ? Math.max(1, Number(p[1])) : 1
  const bv = /BV[0-9A-Za-z]{10}/.exec(url)
  if (bv) return { bvid: bv[0], page }
  const av = /(?:\/video\/|\b)av(\d{1,12})\b/i.exec(url) ?? /[?&]aid=(\d{1,12})\b/i.exec(url)
  if (av) {
    const aid = Number(av[1])
    if (Number.isFinite(aid) && aid > 0) return { aid, page }
  }
  return null
}

function extractBiliPages(view: Record<string, unknown>): BiliPageInfo[] {
  const rawPages = Array.isArray(view.pages) ? (view.pages as unknown[]) : []
  const out: BiliPageInfo[] = []
  rawPages.forEach((raw, idx) => {
    const p = obj(raw)
    const cid = Number(p.cid)
    if (!cid) return
    out.push({
      page: Number(p.page) || idx + 1,
      cid,
      part: str(p.part) || `P${idx + 1}`,
      duration: typeof p.duration === 'number' ? p.duration : undefined,
    })
  })
  return out
}

function extractDashAudioUrl(playData: Record<string, unknown>): string {
  const dash = obj(playData.dash)
  const list = Array.isArray(dash.audio) ? (dash.audio as unknown[]) : []
  let best: { url: string; bandwidth: number } | null = null
  for (const raw of list) {
    const item = obj(raw)
    const url = str(item.baseUrl) || str(item.base_url)
    if (!url) continue
    const bandwidth = typeof item.bandwidth === 'number' ? item.bandwidth : 0
    if (!best || bandwidth > best.bandwidth) best = { url, bandwidth }
  }
  return best?.url ?? ''
}

export function biliMediaFromData(
  view: Record<string, unknown>,
  playData: Record<string, unknown>,
  ref: BiliRef,
  opts?: { audioOnly?: boolean; fallbackAudio?: boolean; partLabel?: string },
): ParsedMedia {
  const title = str(view.title) || ref.bvid || (ref.aid ? `av${ref.aid}` : 'B站视频')
  const author = str(obj(view.owner).name)
  const cover = toHttps(str(view.pic)) || undefined
  const pages = extractBiliPages(view)

  const assets: ParsedAsset[] = []
  if (!opts?.audioOnly) {
    const durl = Array.isArray(playData.durl) ? (playData.durl as unknown[]) : []
    durl.forEach((raw, i) => {
      const url = str(obj(raw).url)
      if (!url) return
      const prefix = opts?.partLabel ? `${opts.partLabel} · ` : ''
      assets.push({
        kind: 'video',
        url,
        label: durl.length > 1 ? `${prefix}分段 ${i + 1}/${durl.length}` : `${prefix}视频（单文件）`,
        filename: '',
        page: ref.page,
      })
    })
  }

  let extractedAudio = false
  if (opts?.audioOnly || (!assets.length && opts?.fallbackAudio)) {
    const audioUrl = extractDashAudioUrl(playData)
    if (audioUrl) {
      extractedAudio = true
      const prefix = opts?.partLabel ? `${opts.partLabel} · ` : ''
      assets.push({
        kind: 'audio',
        url: audioUrl,
        label: `${prefix}音频（M4A）`,
        filename: '',
        page: ref.page,
      })
    }
  }

  // fnval=1 一定给 durl；万一返回 DASH（未登录低码率外的场景），提示而不是静默失败
  if (!assets.length && obj(playData.dash).video) {
    throw new Error('B站返回了音视频分离流，当前版本只取单文件成片，试试其它视频')
  }

  const pageCount = pages.length || Number(view.videos ?? 1) || 1
  const bvid = str(view.bvid) || ref.bvid
  const aid = (typeof view.aid === 'number' && view.aid > 0 ? view.aid : undefined) ?? ref.aid
  const note = extractedAudio && !opts?.audioOnly
    ? '该视频仅返回音视频分离流，已自动提取纯音频（M4A）'
    : pageCount > 1
      ? `共 ${pageCount} P，当前解析第 ${ref.page} P（可在下方切换分 P 或拉取全部分 P）`
      : undefined

  return {
    platform: 'bilibili',
    title,
    author,
    cover,
    assets,
    note,
    bvid: bvid || undefined,
    aid,
    currentPage: ref.page,
    pages: pages.length ? pages : undefined,
  }
}

export async function parseBilibili(input: string, opts?: ParseShareOptions): Promise<ParsedMedia> {
  const signal = opts?.signal
  const url = extractUrl(input) ?? extractBareDomainUrl(input) ?? input.trim()
  if (!url) throw new Error('没找到链接，粘贴整段分享文案即可')

  let ref = extractBiliRef(url)
  if (!ref) {
    // b23.tv / bili2233.cn 等短链先跟随重定向
    try {
      const { finalUrl } = await httpGetText(url, { 'User-Agent': DESKTOP_UA, Accept: 'text/html,*/*' }, signal)
      ref = extractBiliRef(finalUrl) ?? extractBiliRef(decodeURIComponent(finalUrl))
    } catch (e) {
      if (isAbortError(e)) throw e
      throw new Error(formatMediaError(e, '短链解析失败'))
    }
  }
  if (!ref) throw new Error('识别不出 B站视频 BV 或 av 号，换个分享链接试试')

  const headers = { 'User-Agent': DESKTOP_UA, Accept: 'application/json', Referer: 'https://www.bilibili.com/' }
  const viewQuery = ref.bvid ? `bvid=${ref.bvid}` : `aid=${ref.aid}`
  let viewRes: Record<string, unknown>
  try {
    viewRes = obj(await httpGetJson(`https://api.bilibili.com/x/web-interface/view?${viewQuery}`, headers, signal))
  } catch (e) {
    if (isAbortError(e)) throw e
    throw new Error(formatMediaError(e, '获取 B站视频信息失败'))
  }
  if (typeof viewRes.code === 'number' && viewRes.code !== 0) {
    throw new Error(str(viewRes.message) || '视频不存在或无法访问')
  }
  const view = obj(viewRes.data)
  const pages = extractBiliPages(view)
  const bvid = str(view.bvid) || ref.bvid
  const aid = (typeof view.aid === 'number' && view.aid > 0 ? view.aid : undefined) ?? ref.aid
  const playIdQuery = bvid ? `bvid=${bvid}` : `aid=${aid}`

  const fetchBiliPlay = async (url: string): Promise<Record<string, unknown>> => {
    const res = obj(await httpGetJson(url, headers, signal))
    if (typeof res.code === 'number' && res.code !== 0) {
      throw new Error(str(res.message) || '视频流暂不可用（可能需要登录或受地区限制）')
    }
    return obj(res.data)
  }

  if (opts?.allPages && pages.length > 1 && !opts?.audioOnly) {
    const allAssets: ParsedAsset[] = []
    for (const p of pages) {
      throwIfAborted(signal)
      const play = await fetchBiliPlay(
        `https://api.bilibili.com/x/player/playurl?${playIdQuery}&cid=${p.cid}&qn=80&fnval=1&fourk=1`,
      )
      const partMedia = biliMediaFromData(
        view,
        play,
        bvid ? { bvid, page: p.page } : { aid: aid!, page: p.page },
        { partLabel: `P${p.page} ${p.part}`, fallbackAudio: true },
      )
      allAssets.push(...partMedia.assets)
    }
    return {
      platform: 'bilibili',
      title: str(view.title) || bvid || `av${aid}`,
      author: str(obj(view.owner).name),
      cover: toHttps(str(view.pic)) || undefined,
      assets: allAssets,
      note: `已拉取全部 ${pages.length} 个分 P`,
      bvid: bvid || undefined,
      aid,
      currentPage: 1,
      pages,
    }
  }

  const targetPage = opts?.page ?? ref.page
  const matchedPage = pages.find((p) => p.page === targetPage) ?? pages[targetPage - 1]
  const cid = matchedPage?.cid || Number(view.cid)
  if (!cid) throw new Error('拿不到视频分 P 信息，可能视频已失效')

  const activeRef: BiliRef = bvid ? { bvid, page: targetPage } : { aid: aid!, page: targetPage }

  if (opts?.audioOnly) {
    const play = await fetchBiliPlay(
      `https://api.bilibili.com/x/player/playurl?${playIdQuery}&cid=${cid}&qn=80&fnval=16&fourk=1`,
    )
    return biliMediaFromData(view, play, activeRef, { audioOnly: true })
  }

  // qn=80 请求最高（未登录自动降到 720P 档）；fnval=1 出单文件 durl
  const play = await fetchBiliPlay(
    `https://api.bilibili.com/x/player/playurl?${playIdQuery}&cid=${cid}&qn=80&fnval=1&fourk=1`,
  )
  const durl = Array.isArray(play.durl) ? play.durl : []
  if (!durl.length && obj(play.dash).video) {
    const dashPlay = await fetchBiliPlay(
      `https://api.bilibili.com/x/player/playurl?${playIdQuery}&cid=${cid}&qn=80&fnval=16&fourk=1`,
    )
    return biliMediaFromData(view, dashPlay, activeRef, { fallbackAudio: true })
  }
  return biliMediaFromData(view, play, activeRef)
}

/* ---------------- 统一入口与下载 ---------------- */

function resolveInputTarget(text: string): { platform: MediaPlatform; target: string } | null {
  const url = extractUrl(text) ?? extractBareDomainUrl(text)
  if (url) {
    const platform = detectPlatform(url)
    return platform ? { platform, target: url } : null
  }
  const trimmed = text.trim()
  if (extractBiliRef(trimmed)) return { platform: 'bilibili', target: trimmed }
  if (extractDouyinId(trimmed)) return { platform: 'douyin', target: trimmed }
  return null
}

function assignFilenames(media: ParsedMedia): ParsedMedia {
  const prefix = media.platform === 'douyin' ? '抖音' : 'B站'
  const base = sanitizeFilename(media.title)
  const multi = media.assets.length > 1
  const hasMultiPage = Boolean(media.pages && media.pages.length > 1)
  media.assets.forEach((a, i) => {
    const ext = a.kind === 'video' ? 'mp4' : a.kind === 'audio' ? guessAudioExt(a.url) : guessExt(a.url)
    const pagePart = a.page && hasMultiPage ? `-P${a.page}` : ''
    const idxPart = multi ? `-${i + 1}` : ''
    a.filename = `${prefix}-${base}${pagePart}${idxPart}.${ext}`
  })
  return media
}

export async function parseShareText(text: string, opts?: ParseShareOptions): Promise<ParsedMedia> {
  throwIfAborted(opts?.signal)
  const resolved = resolveInputTarget(text)
  if (!resolved) throw new Error('只支持抖音和 B站的链接、BV/av 号或作品 ID')
  const media = resolved.platform === 'douyin'
    ? await parseDouyin(resolved.target, { signal: opts?.signal })
    : await parseBilibili(resolved.target, opts)
  return assignFilenames(media)
}

export function buildCoverAsset(media: ParsedMedia): ParsedAsset | null {
  if (!media.cover) return null
  const prefix = media.platform === 'douyin' ? '抖音' : 'B站'
  const base = sanitizeFilename(media.title)
  return {
    kind: 'image',
    url: toHttps(media.cover),
    label: '视频封面',
    filename: `${prefix}-${base}-封面.${guessExt(media.cover)}`,
  }
}

function guessExt(url: string): string {
  const m = /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i.exec(url)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
}

function guessAudioExt(url: string): string {
  if (/\.mp3(?:[?#]|$)/i.test(url)) return 'mp3'
  return 'm4a'
}

function assetHeaders(url: string): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    Accept: '*/*',
    Referer:
      url.includes('bilibili') || url.includes('hdslb') || url.includes('akamaized') || url.includes('bilivideo')
        ? 'https://www.bilibili.com/'
        : 'https://www.douyin.com/',
  }
}

/** 下载单个素材，返回落盘位置 */
export async function downloadAsset(asset: ParsedAsset, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  const headers = assetHeaders(asset.url)
  if (isNative()) {
    const mimeType =
      asset.kind === 'video'
        ? 'video/mp4'
        : asset.kind === 'audio'
          ? asset.filename.endsWith('.mp3')
            ? 'audio/mpeg'
            : 'audio/mp4'
          : `image/${guessExt(asset.url).replace('jpg', 'jpeg')}`
    return downloadUrlToDownloads(asset.url, asset.filename, headers, mimeType)
  }
  try {
    const blob = await httpGetBlob(asset.url, headers, signal)
    return saveBlob(blob, asset.filename)
  } catch (e) {
    if (isAbortError(e)) throw e
    throw new Error(formatMediaError(e, '下载失败'))
  }
}

/** 图集批量打包为 ZIP 下载 */
export async function downloadImagesAsZip(
  media: ParsedMedia,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const images = media.assets.filter((a) => a.kind === 'image')
  if (!images.length) throw new Error('没有可打包的图片')
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  let done = 0
  for (const img of images) {
    throwIfAborted(signal)
    try {
      const blob = await httpGetBlob(img.url, assetHeaders(img.url), signal)
      zip.file(img.filename || `image-${done + 1}.${guessExt(img.url)}`, await blob.arrayBuffer())
    } catch (e) {
      if (isAbortError(e)) throw e
      throw new Error(formatMediaError(e, `获取 ${img.label} 失败`))
    }
    done++
    onProgress?.(done, images.length)
  }
  throwIfAborted(signal)
  const prefix = media.platform === 'douyin' ? '抖音' : 'B站'
  const zipName = `${prefix}-${sanitizeFilename(media.title)}-图集.zip`
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  return saveBlob(zipBlob, zipName)
}
