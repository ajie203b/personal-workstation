import { db, type Doc } from '@/db/db'
import { mdContentHash, saveMarkdownDoc } from '@/db/docs'
import { fileName, localLink, localMarkdown } from '@/lib/localMarkdown'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, RootContent } from 'mdast'

export const LOCAL_MARKDOWN_LINKS = 'localMarkdownLinks'
const pending = new Map<string, Promise<Doc | null>>()
type Link = string | { id: string; sourceHash: string }

/** Inline local Markdown images in the library snapshot so task backlinks also work on other devices. */
async function snapshotMarkdown(path: string, markdown: string): Promise<string> {
  const tree = unified().use(remarkParse).parse(markdown)
  const edits: { start: number; end: number; text: string }[] = []
  const definitions = new Map(tree.children.filter(n => n.type === 'definition').map(n => [n.identifier, n.url]))
  async function walk(node: Root | RootContent): Promise<void> {
    const url = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier) : undefined
    if (url && node.position && (node.type === 'image' || node.type === 'imageReference')) {
      const target = localLink(path, url)
      if (target && /\.(png|jpe?g|gif|webp|avif)$/i.test(target.path)) {
        try {
          const data = await localMarkdown.image(target.path)
          edits.push({ start: node.position.start.offset!, end: node.position.end.offset!, text: `![${(node.alt ?? '').replace(/[\[\]\\]/g, '\\$&')}](${data})` })
        } catch { /* Keep the original source if the file is missing or outside the chosen folder. */ }
      }
    }
    if ('children' in node) for (const child of node.children) await walk(child as RootContent)
  }
  await walk(tree)
  for (const edit of edits.sort((a, b) => b.start - a.start)) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end)
  return markdown
}

/** Native paths stay on this device. Materialize a library snapshot only for explicit reading actions. */
export async function linkLocalMarkdown(path: string, markdown: string, create = false): Promise<Doc | null> {
  const previous = pending.get(path) ?? Promise.resolve(null)
  const run = previous.catch(() => null).then(async () => {
    const map = (await db.settings.get(LOCAL_MARKDOWN_LINKS))?.value as Record<string, Link> | undefined
    const link = map?.[path]
    const linked = link ? await db.docs.get(typeof link === 'string' ? link : link.id) : undefined
    const existing = linked?.deletedAt ? undefined : linked
    if (!existing && !create) return null
    const sourceHash = mdContentHash('local-source', markdown)
    if (existing && typeof link === 'object' && link.sourceHash === sourceHash) return existing
    const snapshot = await snapshotMarkdown(path, markdown)
    const saved = await saveMarkdownDoc({ doc: existing ?? null, title: fileName(path).replace(/\.(md|markdown)$/i, ''), markdown: snapshot })
    await db.transaction('rw', db.settings, async () => {
      const current = (await db.settings.get(LOCAL_MARKDOWN_LINKS))?.value as Record<string, Link> | undefined
      await db.settings.put({ key: LOCAL_MARKDOWN_LINKS, value: { ...current, [path]: { id: saved.id, sourceHash } } })
    })
    return saved
  })
  pending.set(path, run)
  try { return await run } finally { if (pending.get(path) === run) pending.delete(path) }
}
