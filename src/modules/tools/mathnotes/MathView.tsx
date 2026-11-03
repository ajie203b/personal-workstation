import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/** KaTeX 渲染一段 LaTeX（出错时显示原文，不抛异常） */
export const MathView = memo(function MathView({ latex, className, display = false }: { latex: string; className?: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { throwOnError: false, displayMode: display, output: 'html', strict: 'ignore' })
    } catch {
      return null
    }
  }, [latex, display])
  if (html == null) return <code className={className}>{latex}</code>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
