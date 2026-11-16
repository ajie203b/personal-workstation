import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  Combine,
  FileImage,
  FileStack,
  ImagePlus,
  PenLine,
  Scissors,
  Stamp,
  LockKeyhole,
  Minimize2,
} from 'lucide-react'
import { IconToolPdf } from '@/shared/icons'
import { BackButton } from '@/shared/ui/BackButton'
import type { SegmentOption } from '@/shared/ui/Segmented'
import { cn } from '@/lib/cn'
import { PdfHandoffContext, type PdfToolTab, type PendingPdfHandoff } from './handoff'
import { MergePanel } from './MergePanel'
import { SplitPanel } from './SplitPanel'
import { PagesPanel } from './PagesPanel'
import { ImagesToPdfPanel } from './ImagesToPdfPanel'
import { PdfToImagesPanel } from './PdfToImagesPanel'
import { WatermarkPanel } from './WatermarkPanel'
import { SignaturePanel } from './SignaturePanel'
import { CompressPanel } from './CompressPanel'
import { SecurityPanel } from './SecurityPanel'

const TABS: SegmentOption<PdfToolTab>[] = [
  { value: 'merge', label: '合并', icon: Combine },
  { value: 'split', label: '拆分提取', icon: Scissors },
  { value: 'pages', label: '页面整理', icon: FileStack },
  { value: 'img2pdf', label: '图转PDF', icon: ImagePlus },
  { value: 'pdf2img', label: 'PDF转图', icon: FileImage },
  { value: 'watermark', label: '水印页码', icon: Stamp },
  { value: 'sign', label: '手写签名', icon: PenLine },
  { value: 'compress', label: '压缩', icon: Minimize2 },
  { value: 'security', label: '加密解密', icon: LockKeyhole },
]

/**
 * PDF 工具箱（v3.3）：合并 / 拆分 / 删页旋转 / 图转 PDF / PDF 转图 / 水印页码 / 手写签名。
 * 全部本地处理（pdf-lib + pdf.js），每个功能两个出口：存「下载/个人工作站」或进文档库。
 */
export function PdfToolPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tool')
  const tab = TABS.some(item => item.value === requested) ? requested as PdfToolTab : 'merge'

  const tablistRef = useRef<HTMLDivElement>(null)
  const hasMounted = useRef(false)
  const seqRef = useRef(0)
  const [pending, setPending] = useState<PendingPdfHandoff | null>(null)
  const [scrollFade, setScrollFade] = useState({ left: false, right: false })

  const updateScrollFade = useCallback(() => {
    const el = tablistRef.current
    if (!el) return
    setScrollFade({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }, [])

  useEffect(() => {
    const el = document.getElementById(`pdf-tool-${tab}`)
    el?.scrollIntoView?.({
      behavior: hasMounted.current ? 'smooth' : 'auto',
      inline: 'center',
      block: 'nearest',
    })
    hasMounted.current = true
  }, [tab])

  useEffect(() => {
    updateScrollFade()
    const el = tablistRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(updateScrollFade)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollFade])

  const handoff = useCallback((file: File, targetTab: PdfToolTab) => {
    setPending({ tab: targetTab, file, seq: ++seqRef.current })
    setParams({ tool: targetTab }, { replace: true })
  }, [setParams])

  const clearHandoff = useCallback((seq: number) => {
    setPending(prev => (prev && prev.seq === seq ? null : prev))
  }, [])

  const handoffValue = useMemo(
    () => ({ currentTab: tab, pending, handoff, clearHandoff }),
    [tab, pending, handoff, clearHandoff],
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolPdf size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="hidden md:block text-[22px] font-bold leading-7">PDF 工具箱</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            合并、页面整理、转换、签名、压缩与密码保护。全程本地处理，文件不出设备。
          </p>
        </div>
      </header>

      <div className="relative rounded-[14px]">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="PDF 工具"
          onScroll={updateScrollFade}
          className="flex gap-1 overflow-x-auto rounded-[14px] bg-surface-3/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map(item => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} tabIndex={tab === item.value ? 0 : -1}
            aria-controls="pdf-tool-panel" id={`pdf-tool-${item.value}`}
            onClick={() => setParams({ tool: item.value }, { replace: true })}
            onKeyDown={e => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
              e.preventDefault()
              const index = TABS.findIndex(t => t.value === item.value)
              const next = e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : TABS[(index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]
              setParams({ tool: next.value }, { replace: true })
              document.getElementById(`pdf-tool-${next.value}`)?.focus()
            }}
            className={cn('flex flex-1 shrink-0 items-center justify-center gap-1.5 min-h-11 px-3 rounded-[10px] text-[12px] whitespace-nowrap cursor-pointer transition-colors', tab === item.value ? 'bg-surface text-primary font-semibold shadow-sm' : 'text-on-surface-2 hover:text-on-surface hover:bg-surface/60')}>
            {item.icon && <item.icon size={15} aria-hidden />}<span>{item.label}</span>
          </button>)}
        </div>
        {scrollFade.left && (
          <span aria-hidden className="md:hidden pointer-events-none absolute left-0 inset-y-1 w-6 rounded-l-[14px] bg-gradient-to-r from-surface-3/90 to-transparent" />
        )}
        {scrollFade.right && (
          <span aria-hidden className="md:hidden pointer-events-none absolute right-0 inset-y-1 w-6 rounded-r-[14px] bg-gradient-to-l from-surface-3/90 to-transparent" />
        )}
      </div>

      <PdfHandoffContext.Provider value={handoffValue}>
        <div role="tabpanel" id="pdf-tool-panel" aria-labelledby={`pdf-tool-${tab}`} className="flex flex-col gap-4">
          {tab === 'merge' && <MergePanel />}
          {tab === 'split' && <SplitPanel />}
          {tab === 'pages' && <PagesPanel />}
          {tab === 'img2pdf' && <ImagesToPdfPanel />}
          {tab === 'pdf2img' && <PdfToImagesPanel />}
          {tab === 'watermark' && <WatermarkPanel />}
          {tab === 'sign' && <SignaturePanel />}
          {tab === 'compress' && <CompressPanel />}
          {tab === 'security' && <SecurityPanel />}
        </div>
      </PdfHandoffContext.Provider>

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        超大 PDF（约 100MB 以上）处理会慢一些、占内存；「PDF 转图」建议先用 150 DPI 试效果。
        压缩、解密等处理会生成新副本，请保存结果并核对页面。
      </p>
    </div>
  )
}
