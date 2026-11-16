import { createContext, useContext, useEffect, useRef } from 'react'

export type PdfToolTab = 'merge' | 'split' | 'pages' | 'img2pdf' | 'pdf2img' | 'watermark' | 'sign' | 'compress' | 'security'

export const HANDOFF_TARGETS: { value: PdfToolTab; label: string }[] = [
  { value: 'compress', label: '压缩 PDF' },
  { value: 'watermark', label: '水印 / 页码' },
  { value: 'sign', label: '手写签名' },
  { value: 'security', label: '加密 / 解密' },
  { value: 'pages', label: '页面整理' },
  { value: 'split', label: '拆分 / 提取' },
  { value: 'pdf2img', label: 'PDF 转图片' },
  { value: 'merge', label: '合并 PDF' },
]

export interface PendingPdfHandoff {
  tab: PdfToolTab
  file: File
  seq: number
}

export interface PdfHandoffContextValue {
  currentTab: PdfToolTab
  pending: PendingPdfHandoff | null
  handoff: (file: File, targetTab: PdfToolTab) => void
  clearHandoff: (seq: number) => void
}

export const PdfHandoffContext = createContext<PdfHandoffContextValue | null>(null)

export function usePdfHandoffContext(): PdfHandoffContextValue | null {
  return useContext(PdfHandoffContext)
}

/** 面板挂载时接收来自上一工具的内存 PDF 交接（兼容 React StrictMode 双调用）。 */
export function usePdfHandoff(tab: PdfToolTab, onReceive: (file: File) => void): void {
  const ctx = usePdfHandoffContext()
  const onReceiveRef = useRef(onReceive)
  onReceiveRef.current = onReceive
  const pending = ctx?.pending
  const clearHandoff = ctx?.clearHandoff

  useEffect(() => {
    if (!pending || pending.tab !== tab || !clearHandoff) return
    onReceiveRef.current(pending.file)
    const seq = pending.seq
    const timer = setTimeout(() => clearHandoff(seq), 0)
    return () => clearTimeout(timer)
  }, [pending, tab, clearHandoff])
}
