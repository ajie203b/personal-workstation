import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/**
 * 正文 HTML → Markdown（v3.3 文章离线）。
 * turndown + GFM（表格 / 删除线 / 任务列表）；文首固定写来源 URL、标题、抓取时间，
 * 文档库里一眼能看出来路。
 */

export interface MarkdownInput {
  title: string
  byline?: string
  sourceUrl?: string
  /** 抓取时间（毫秒时间戳） */
  capturedAt: number
  contentHtml: string
}

/** 'YYYY-MM-DD HH:mm'（本机时区） */
export function formatCapturedAt(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })
  td.use(gfm)
  // 清洗已在 sanitizeHtml 做过，这里只是双保险
  td.remove(['script', 'style', 'iframe', 'noscript', 'button', 'input', 'select', 'textarea'])
  return td
}

/** 文首信息块 + 正文 */
export function buildArticleMarkdown(input: MarkdownInput): string {
  const td = buildTurndown()
  const body = td.turndown(input.contentHtml || '').trim()

  const header: string[] = [`# ${input.title.trim() || '无标题文章'}`, '']
  header.push(`> 来源：${input.sourceUrl || '（粘贴内容，无来源链接）'}`)
  if (input.byline) header.push(`> 作者：${input.byline}`)
  header.push(`> 抓取时间：${formatCapturedAt(input.capturedAt)}`)
  header.push('', '---', '')

  return header.join('\n') + (body ? `${body}\n` : '')
}
