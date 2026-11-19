import { memo, useDeferredValue, useMemo } from 'react'

/** Source characters, excluding whitespace and embedded base64 data URIs; count Unicode code points. */
export function countMarkdownCharacters(markdown: string): number {
  const stripped = markdown.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, '')
  let count = 0
  for (const character of stripped) if (!/\s/u.test(character)) count++
  return count
}

export const MarkdownWordCount = memo(function MarkdownWordCount({ markdown }: { markdown: string }) {
  const deferredMarkdown = useDeferredValue(markdown)
  const count = useMemo(() => countMarkdownCharacters(deferredMarkdown), [deferredMarkdown])
  return <div aria-label="Markdown 总字数" title="按 Markdown 原文统计，不含空格、换行等空白字符"
    className="shrink-0 flex items-center justify-end px-3 py-1 text-[11px] leading-none text-on-surface-2/80 tabular-nums select-none"
    style={{ paddingRight: 'max(12px, env(safe-area-inset-right, 0px))' }}>
    总字数：{count.toLocaleString('zh-CN')}
  </div>
})
