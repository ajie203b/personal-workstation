/**
 * 智能分享收件箱分类器（Phase 3）：
 * 统一解析 Web Share Target 与安卓 ACTION_SEND 传入的 title / text / url，
 * 识别抖音/B站、番茄小说、网页文章与纯文本并生成直达目标路由。
 */

export type ShareIntentKind = 'media' | 'fanqie' | 'article' | 'text'

export interface ShareClassification {
  kind: ShareIntentKind
  title: string
  text: string
  url: string
  /** 传给无水印下载或保存的完整原文 */
  rawPayload: string
  /** 建议的主分流路由（纯文本为 null，由用户选择入文档库或转任务） */
  primaryRoute: string | null
  primaryLabel: string
  badge: string
}

const URL_RE = /https?:\/\/[^\s"'<>]+/i
const TRAILING_PUNCT_RE = /[),.;!?，。；！？、）】》」』’”\]]+$/
const MEDIA_HOST_RE = /(?:^|\.)(?:douyin\.com|iesdouyin\.com|bilibili\.com|b23\.tv|acg\.tv)$/i
const FANQIE_HOST_RE = /(?:^|\.)(?:fanqienovel\.com|changdunovel\.com|fqnovel\.com)$/i
const BV_RE = /\bBV1[0-9A-Za-z]{9}\b/

export function extractFirstHttpUrl(input: string): string {
  const m = URL_RE.exec(input)
  if (!m) return ''
  const candidate = m[0].replace(TRAILING_PUNCT_RE, '')
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.href
  } catch {
    return ''
  }
}

export function classifySharePayload(input: {
  title?: string | null
  text?: string | null
  url?: string | null
}): ShareClassification {
  const rawTitle = (input.title ?? '').trim()
  const rawText = (input.text ?? '').trim()
  const rawUrl = (input.url ?? '').trim()

  const extractedUrl = extractFirstHttpUrl(rawUrl) || extractFirstHttpUrl(rawText)
  const rawPayload = [rawText, rawUrl && !rawText.includes(rawUrl) ? rawUrl : ''].filter(Boolean).join('\n\n')
  const fallbackTitle = rawTitle || (extractedUrl ? (() => {
    try { return new URL(extractedUrl).hostname.replace(/^www\./, '') } catch { return '分享链接' }
  })() : '分享内容')

  if (extractedUrl) {
    let host: string
    try { host = new URL(extractedUrl).hostname.toLowerCase() } catch { host = '' }

    if (MEDIA_HOST_RE.test(host)) {
      const q = rawPayload || extractedUrl
      return {
        kind: 'media',
        title: fallbackTitle,
        text: rawText,
        url: extractedUrl,
        rawPayload: q,
        primaryRoute: `/tools/media?q=${encodeURIComponent(q)}`,
        primaryLabel: '前往无水印解析',
        badge: '抖音 / B 站链接',
      }
    }

    if (FANQIE_HOST_RE.test(host)) {
      return {
        kind: 'fanqie',
        title: fallbackTitle,
        text: rawText,
        url: extractedUrl,
        rawPayload: rawPayload || extractedUrl,
        primaryRoute: `/tools/fanqie?q=${encodeURIComponent(extractedUrl)}`,
        primaryLabel: '前往番茄小说下载',
        badge: '番茄小说链接',
      }
    }

    return {
      kind: 'article',
      title: fallbackTitle,
      text: rawText,
      url: extractedUrl,
      rawPayload: rawPayload || extractedUrl,
      primaryRoute: `/tools/article?url=${encodeURIComponent(extractedUrl)}`,
      primaryLabel: '离线剪藏（带图片）',
      badge: '网页文章链接',
    }
  }

  if (BV_RE.test(rawPayload)) {
    return {
      kind: 'media',
      title: fallbackTitle,
      text: rawText,
      url: '',
      rawPayload,
      primaryRoute: `/tools/media?q=${encodeURIComponent(rawPayload)}`,
      primaryLabel: '前往 B 站无水印解析',
      badge: 'B 站 BV 号',
    }
  }

  return {
    kind: 'text',
    title: fallbackTitle,
    text: rawText,
    url: '',
    rawPayload,
    primaryRoute: null,
    primaryLabel: '存入文档工作站',
    badge: '纯文本内容',
  }
}
