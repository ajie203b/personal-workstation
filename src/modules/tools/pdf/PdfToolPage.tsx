import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Combine,
  FileImage,
  FileStack,
  ImagePlus,
  PenLine,
  Scissors,
  Stamp,
  Wrench,
} from 'lucide-react'
import { BackButton } from '@/shared/ui/BackButton'
import { Segmented, type SegmentOption } from '@/shared/ui/Segmented'
import { MergePanel } from './MergePanel'
import { SplitPanel } from './SplitPanel'
import { PagesPanel } from './PagesPanel'
import { ImagesToPdfPanel } from './ImagesToPdfPanel'
import { PdfToImagesPanel } from './PdfToImagesPanel'
import { WatermarkPanel } from './WatermarkPanel'
import { SignaturePanel } from './SignaturePanel'
import { SoonPanel } from './SoonPanel'

type Tab = 'merge' | 'split' | 'pages' | 'img2pdf' | 'pdf2img' | 'watermark' | 'sign' | 'soon'

const TABS: SegmentOption<Tab>[] = [
  { value: 'merge', label: '合并', icon: Combine },
  { value: 'split', label: '拆分提取', icon: Scissors },
  { value: 'pages', label: '删页旋转', icon: FileStack },
  { value: 'img2pdf', label: '图转PDF', icon: ImagePlus },
  { value: 'pdf2img', label: 'PDF转图', icon: FileImage },
  { value: 'watermark', label: '水印页码', icon: Stamp },
  { value: 'sign', label: '手写签名', icon: PenLine },
  { value: 'soon', label: '更多', icon: Wrench },
]

/**
 * PDF 工具箱（v3.3）：合并 / 拆分 / 删页旋转 / 图转 PDF / PDF 转图 / 水印页码 / 手写签名。
 * 全部本地处理（pdf-lib + pdf.js），每个功能两个出口：存「下载/个人工作站」或进文档库。
 */
export function PdfToolPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('merge')

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <FileStack size={21} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">PDF 工具箱</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            合并、拆分、删页旋转、图转 PDF、水印页码、手写签名——全程本地处理，文件不出设备
          </p>
        </div>
      </header>

      {/* 窄屏 8 个入口放不下，图标常驻、文字到 md 才出现，整体可横滑 */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="PDF 工具" size="sm" />
      </div>

      {tab === 'merge' && <MergePanel />}
      {tab === 'split' && <SplitPanel />}
      {tab === 'pages' && <PagesPanel />}
      {tab === 'img2pdf' && <ImagesToPdfPanel />}
      {tab === 'pdf2img' && <PdfToImagesPanel />}
      {tab === 'watermark' && <WatermarkPanel />}
      {tab === 'sign' && <SignaturePanel />}
      {tab === 'soon' && <SoonPanel />}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        超大 PDF（约 100MB 以上）处理会慢一些、占内存；「PDF 转图」建议先用 150 DPI 试效果。
        压缩与加密/解密即将支持。
      </p>
    </div>
  )
}
