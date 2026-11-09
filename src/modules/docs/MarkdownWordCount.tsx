import { memo, useDeferredValue, useMemo } from 'react'

/** Source characters, excluding whitespace; count Unicode code points rather than UTF-16 units. */
export function countMarkdownCharacters(markdown: string): number {
  let count = 0
  for (const character of markdown) if (!/\s/u.test(character)) count++
  return count
}

export const MarkdownWordCount = memo(function MarkdownWordCount({ markdown }: { markdown: string }) {
  const deferredMarkdown = useDeferredValue(markdown)
  const count = useMemo(() => countMarkdownCharacters(deferredMarkdown), [deferredMarkdown])
  return <div aria-label="Markdown 总字数" title="按 Markdown 原文统计，不含空格、换行等空白字符"
    className="shrink-0 flex justify-end border-t border-outline/40 bg-surface px-3 py-1 text-[11px] text-on-surface-2 tabular-nums"
    style={{ paddingRight: 'max(12px, env(safe-area-inset-right, 0px))', paddingBottom: 'max(4px, env(safe-area-inset-bottom, 0px))' }}>
    总字数：{count.toLocaleString('zh-CN')}
  </div>
})
