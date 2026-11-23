import { useEffect } from 'react'

const DEFAULT_TITLE = 'Kairos'
const DOC_EXT_RE = /\.(md|markdown|txt|csv|tsv|json|html|htm|pdf|docx|pptx|epub)$/i

/** 规范化文档打印标题：去掉常见扩展名，空值回退到 Kairos，确保另存为 PDF 默认使用原文件名。 */
export function cleanPrintTitle(raw?: string | null): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return DEFAULT_TITLE
  const stripped = trimmed.replace(DOC_EXT_RE, '').trim()
  return stripped || trimmed
}

/**
 * 同步 document.title 为当前文档原文件名，并在打印期间临时清空地址栏里的 hash/路径查询串，
 * 避免浏览器/WebView2 打印页脚把百分号编码的本地路径（如 #/local-markdown?file=...%E4%B8%AD...）印成一行英文乱码。
 */
export function useDocumentPrintTitle(rawTitle?: string | null) {
  const printTitle = cleanPrintTitle(rawTitle)

  useEffect(() => {
    document.title = printTitle

    let savedUrl: string | null = null
    const restoreUrl = () => {
      if (savedUrl == null) return
      const target = savedUrl
      savedUrl = null
      try {
        window.history.replaceState(window.history.state, '', target)
      } catch {
        /* 忽略受限环境 */
      }
    }

    const onBeforePrint = () => {
      document.title = printTitle
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (!window.location.search && !window.location.hash) return
      savedUrl = current
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname || '/')
      } catch {
        savedUrl = null
      }
    }

    window.addEventListener('beforeprint', onBeforePrint)
    window.addEventListener('afterprint', restoreUrl)
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint)
      window.removeEventListener('afterprint', restoreUrl)
      restoreUrl()
      document.title = DEFAULT_TITLE
    }
  }, [printTitle])
}
