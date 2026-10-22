import { FileStack } from 'lucide-react'
import { ToolPlaceholder } from '../ToolPlaceholder'

/** PDF 工具箱（v3.3）——实现中，占位 */
export function PdfToolPage() {
  return <ToolPlaceholder icon={FileStack} title="PDF 工具箱" hint="合并、拆分、排序、旋转、签名、水印、图转 PDF。" />
}
