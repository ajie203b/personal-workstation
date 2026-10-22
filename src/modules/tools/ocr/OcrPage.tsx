import { ScanText } from 'lucide-react'
import { ToolPlaceholder } from '../ToolPlaceholder'

/** 本地 OCR（v3.3）——实现中，占位 */
export function OcrPage() {
  return <ToolPlaceholder icon={ScanText} title="本地 OCR" hint="拍照 / 截图取文字，点框复制、存为文档，全程本地处理。" />
}
