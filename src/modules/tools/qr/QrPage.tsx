import { QrCode } from 'lucide-react'
import { ToolPlaceholder } from '../ToolPlaceholder'

/** 二维码生成与扫码（v3.3）——实现中，占位 */
export function QrPage() {
  return <ToolPlaceholder icon={QrCode} title="二维码" hint="生成二维码、扫码识别：文本 / 网址 / WiFi / 名片，导出 PNG / SVG。" />
}
