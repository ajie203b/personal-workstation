import type { Doc } from '@/db/db'

/**
 * 文档库双向链接 `[[文档标题]]` / `[[文档标题|别名]]` 解析与匹配工具（Phase 4）：
 * - remarkWikiLinks：将 Markdown 正文中的双链转为 `wiki:<encoded>` 链接，由 MdReader 渲染为可点击文档跳转
 * - extractWikiLinkTargets / docMentionsTitle：供阅读器反链面板发现引用当前文档的其他文档
 */

const WIKI_LINK_RE = /\[\[([^[\]|#\r\n]+?)(?:\|([^[\]\r\n]+?))?\]\]/g
const FENCED_CODE_RE = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g
const INLINE_CODE_RE = /`[^`\n]+`/g
const DOC_EXT_RE = /\.(?:md|markdown|txt|pdf|epub|docx|pptx|html?)$/i

export function normalizeWikiTitle(title: string): string {
  return title.trim().replace(DOC_EXT_RE, '').trim().toLowerCase()
}

export function extractWikiLinkTargets(md: string): string[] {
  if (!md || !md.includes('[[')) return []
  const stripped = md.replace(FENCED_CODE_RE, '\n').replace(INLINE_CODE_RE, '')
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of stripped.matchAll(WIKI_LINK_RE)) {
    const target = (m[1] ?? '').trim()
    if (!target) continue
    const key = normalizeWikiTitle(target)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

export function findDocByWikiTarget(docs: readonly Doc[], target: string): Doc | undefined {
  const norm = normalizeWikiTitle(target)
  if (!norm) return undefined
  return docs.find((d) => !d.deletedAt && normalizeWikiTitle(d.title) === norm)
}

export function docMentionsTitle(text: string, targetTitle: string): boolean {
  const norm = normalizeWikiTitle(targetTitle)
  if (!norm || !text.includes('[[')) return false
  return extractWikiLinkTargets(text).some((t) => normalizeWikiTitle(t) === norm)
}

/** Remark 插件：将普通文本节点里的 `[[目标]]` / `[[目标|别名]]` 转为 `wiki:` 链接 */
export function remarkWikiLinks() {
  return (tree: unknown) => {
    walkWiki(tree)
  }
}

function walkWiki(node: unknown) {
  const n = node as { children?: unknown[]; type?: string }
  if (!n.children) return
  const out: unknown[] = []
  for (const child of n.children) {
    const c = child as { type?: string; value?: string; children?: unknown[] }
    if (c.type === 'text' && typeof c.value === 'string' && c.value.includes('[[')) {
      out.push(...splitWikiText(c.value))
    } else {
      if (c.type !== 'code' && c.type !== 'inlineCode' && c.type !== 'link') walkWiki(child)
      out.push(child)
    }
  }
  n.children = out
}

function splitWikiText(text: string): unknown[] {
  const out: unknown[] = []
  let last = 0
  for (const m of text.matchAll(WIKI_LINK_RE)) {
    const idx = m.index ?? 0
    const target = (m[1] ?? '').trim()
    if (!target) continue
    const label = (m[2] ?? '').trim() || target
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) })
    out.push({
      type: 'link',
      url: `wiki:${encodeURIComponent(target)}`,
      title: `跳转到文档：${target}`,
      children: [{ type: 'text', value: label }],
    })
    last = idx + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out.length ? out : [{ type: 'text', value: text }]
}
