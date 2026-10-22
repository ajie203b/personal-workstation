import { CapacitorHttp } from '@capacitor/core'
import { isNative } from './native'
import { sanitizeFilename } from './fanqieExport'
import { saveBlob } from './saveFile'

/**
 * 无水印解析（抖音 / B站）。
 *
 * 两个平台的取流配方都来自 GitHub 上 2026-10 仍在维护的开源实现，并在本机实测过：
 * - 抖音：移动端 feed 协议 `/aweme/v1/feed/`（免签名、免 Cookie）——2026-08 起
 *   a_bogus 纯签名被 Argus 网关拦死后，这是唯一免指纹的通道；字节只对机房 IP
 *   软限流（推荐流顶替目标作品），手机家宽不受影响。配方参考
 *   Student414/douyin-cf-downloader（MIT，转译自 jiji262/douyin-downloader）。
 * - B站：官方 web 接口 `x/web-interface/view` + `x/player/playurl`，
 *   fnval=1 取 durl 单文件 MP4（免 ffmpeg 合流；未登录上限 720P）。
 *
 * 仅供个人离线收藏，请支持原作者。
 */

export type MediaPlatform = 'douyin' | 'bilibili'

export interface ParsedAsset {
  kind: 'video' | 'image'
  url: string
  /** 展示用标签：画质档位或序号 */
  label: string
  filename: string
}

export interface ParsedMedia {
  platform: MediaPlatform
  title: string
  author: string
  cover?: string
  assets: ParsedAsset[]
  /** 提示语（画质说明、分P 说明等） */
  note?: string
}

/* ---------------- HTTP（原生 CapacitorHttp / 网页 fetch） ---------------- */

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function httpGetText(url: string, headers: Record<string, string>): Promise<{ body: string; finalUrl: string }> {
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      responseType: 'text',
      connectTimeout: 15_000,
      readTimeout: 30_000,
    })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return { body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''), finalUrl: res.url || url }
  }
  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { body: await res.text(), finalUrl: res.url || url }
}

async function httpGetJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const { body } = await httpGetText(url, headers)
  if (!body.trim()) throw new Error('空响应')
  return JSON.parse(body)
}

/** 媒体二进制：原生走 CapacitorHttp（绕 CORS），网页走 fetch */
async function httpGetBlob(url: string, headers: Record<string, string>): Promise<Blob> {
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      responseType: 'arraybuffer',
      connectTimeout: 15_000,
      readTimeout: 120_000,
    })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    const data = res.data as string | ArrayBuffer
    if (typeof data === 'string') return base64ToBlob(data)
    return new Blob([data])
  }
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

function base64ToBlob(b64: string): Blob {
  // CapacitorHttp 对 arraybuffer 返回 base64；同 saveFile 的分块思路防大数组爆栈
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes])
}

/* ---------------- 公共：链接提取与平台识别 ---------------- */

/** 从分享文案里取第一条链接（结尾的中文标点/括号不算链接） */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>"'，。；！？、）)】]+/i.exec(text)
  return m ? m[0] : null
}

export function detectPlatform(url: string): MediaPlatform | null {
  const host = url.toLowerCase()
  if (/(^|\/\/|\.)((v|www)\.)?(douyin|iesdouyin|amemv)\.com/.test(host) || host.includes('douyinvod.com')) return 'douyin'
  if (/(^|\/\/|\.)((www|m)\.)?bilibili\.com/.test(host) || host.includes('b23.tv')) return 'bilibili'
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
  return String(Math.floor(Math.random() * 8e18) + 1e18)
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

/** feed 命中的 item → 标题/作者/素材（视频取最高档；图集逐张） */
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

  const cover = firstUrl(video.cover) || firstUrl(video.origin_cover) || firstUrl(item.images)
  return {
    platform: 'douyin',
    title,
    author,
    cover: cover || undefined,
    assets,
    note: assets.some((a) => a.kind === 'video')
      ? '清晰度来自作品源（feed 协议常见 720P 档）'
      : undefined,
  }
}

export async function parseDouyin(input: string): Promise<ParsedMedia> {
  const url = extractUrl(input) ?? input.trim()
  if (!url) throw new Error('没找到链接，粘贴整段分享文案即可')

  // 短链先跟随重定向拿作品 ID；长链/裸 ID 直接提取
  let awemeId = extractDouyinId(url)
  if (!awemeId) {
    const { finalUrl } = await httpGetText(url, { 'User-Agent': DESKTOP_UA, Accept: 'text/html,*/*' })
    awemeId = extractDouyinId(finalUrl) ?? extractDouyinId(decodeURIComponent(finalUrl))
  }
  if (!awemeId) throw new Error('识别不出抖音作品 ID，换个分享链接试试')

  // feed 协议：3 host × 2 档案 × 2 轮，命中 aweme_list 里的目标作品为止
  let lastError = '所有节点都没有返回这部作品'
  for (let round = 0; round < 2; round++) {
    for (const prof of DOUYIN_PROFILES) {
      for (const base of DOUYIN_BASES) {
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
          const data = obj(await httpGetJson(`${base}/aweme/v1/feed/?${qs}`, {
            'User-Agent': prof.ua,
            Accept: 'application/json',
          }))
          const list = Array.isArray(data.aweme_list) ? (data.aweme_list as unknown[]) : []
          const hit = list.map(obj).find((it) => str(it.aweme_id) === awemeId)
          if (hit) return douyinMediaFromItem(hit, awemeId)
          // code=0 但列表里没有目标 = 软限流（推荐流顶替），换节点继续
          lastError = '节点返回了推荐流而不是这部作品（被软限流），稍后再试'
        } catch (e) {
          lastError = e instanceof Error ? e.message : '请求失败'
        }
      }
    }
  }
  throw new Error(`抖音解析失败：${lastError}`)
}

/* ---------------- B站 ---------------- */

export interface BiliRef {
  bvid: string
  /** 分P，从 1 开始 */
  page: number
}

/** B站长链 / b23.tv 短链 / 纯 BV 号 → BV + 分P */
export function extractBiliRef(url: string): BiliRef | null {
  const bv = /BV[0-9A-Za-z]{10}/.exec(url)
  const p = /[?&]p=(\d+)/.exec(url)
  if (bv) return { bvid: bv[0], page: p ? Math.max(1, Number(p[1])) : 1 }
  return null
}

export function biliMediaFromData(
  view: Record<string, unknown>,
  playData: Record<string, unknown>,
  ref: BiliRef,
): ParsedMedia {
  const title = str(view.title) || ref.bvid
  const author = str(obj(view.owner).name)
  const cover = str(view.pic) || undefined

  const assets: ParsedAsset[] = []
  const durl = Array.isArray(playData.durl) ? (playData.durl as unknown[]) : []
  durl.forEach((raw, i) => {
    const url = str(obj(raw).url)
    if (!url) return
    assets.push({
      kind: 'video',
      url,
      label: durl.length > 1 ? `分段 ${i + 1}/${durl.length}` : '视频（单文件）',
      filename: '',
    })
  })
  // fnval=1 一定给 durl；万一返回 DASH（未登录低码率外的场景），提示而不是静默失败
  if (!assets.length && obj(playData.dash).video) {
    throw new Error('B站返回了音视频分离流，当前版本只取单文件成片，试试其它视频')
  }

  const pageCount = Array.isArray(view.pages) ? view.pages.length : Number(view.videos ?? 1) || 1
  return {
    platform: 'bilibili',
    title,
    author,
    cover,
    assets,
    note: pageCount > 1 ? `共 ${pageCount} P，当前解析第 ${ref.page} P（链接里带 ?p=N 可换）` : undefined,
  }
}

export async function parseBilibili(input: string): Promise<ParsedMedia> {
  const url = extractUrl(input) ?? input.trim()
  if (!url) throw new Error('没找到链接，粘贴整段分享文案即可')

  let ref = extractBiliRef(url)
  if (!ref) {
    // b23.tv 等短链先跟随重定向
    const { finalUrl } = await httpGetText(url, { 'User-Agent': DESKTOP_UA, Accept: 'text/html,*/*' })
    ref = extractBiliRef(finalUrl) ?? extractBiliRef(decodeURIComponent(finalUrl))
  }
  if (!ref) throw new Error('识别不出 B站视频 BV 号，换个分享链接试试')

  const headers = { 'User-Agent': DESKTOP_UA, Accept: 'application/json', Referer: 'https://www.bilibili.com/' }
  const view = obj(obj(await httpGetJson(`https://api.bilibili.com/x/web-interface/view?bvid=${ref.bvid}`, headers)).data)
  const pages = Array.isArray(view.pages) ? (view.pages as unknown[]) : []
  const cid = ref.page > 0 && pages[ref.page - 1] ? Number(obj(pages[ref.page - 1]).cid) : Number(view.cid)
  if (!cid) throw new Error('拿不到视频分 P 信息，可能视频已失效')

  // qn=80 请求最高（未登录自动降到 720P 档）；fnval=1 出单文件 durl
  const play = obj(
    obj(await httpGetJson(
      `https://api.bilibili.com/x/player/playurl?bvid=${ref.bvid}&cid=${cid}&qn=80&fnval=1&fourk=1`,
      headers,
    )).data,
  )
  return biliMediaFromData(view, play, ref)
}

/* ---------------- 统一入口与下载 ---------------- */

export async function parseShareText(text: string): Promise<ParsedMedia> {
  const url = extractUrl(text)
  const platform = url ? detectPlatform(url) : null
  if (!platform) throw new Error('只支持抖音和 B站的链接')
  const media = platform === 'douyin' ? await parseDouyin(text) : await parseBilibili(text)
  // 文件名：平台前缀 + 标题；素材序号由下载时拼
  const base = sanitizeFilename(media.title)
  media.assets.forEach((a, i) => {
    const ext = a.kind === 'video' ? 'mp4' : guessExt(a.url)
    a.filename = `${media.platform === 'douyin' ? '抖音' : 'B站'}-${base}${media.assets.length > 1 ? `-${i + 1}` : ''}.${ext}`
  })
  return media
}

function guessExt(url: string): string {
  const m = /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i.exec(url)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
}

/** 下载单个素材到「下载/个人工作站」，返回落盘位置 */
export async function downloadAsset(asset: ParsedAsset): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
    Accept: '*/*',
    Referer: asset.url.includes('bilibili') || asset.url.includes('hdslb') || asset.url.includes('akamaized')
      ? 'https://www.bilibili.com/'
      : 'https://www.douyin.com/',
  }
  const blob = await httpGetBlob(asset.url, headers)
  return saveBlob(blob, asset.filename)
}
