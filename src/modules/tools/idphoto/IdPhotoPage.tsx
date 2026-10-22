import { ScanFace } from 'lucide-react'
import { ToolPlaceholder } from '../ToolPlaceholder'

/** 证件照 / 报名照（v3.3）——实现中，占位 */
export function IdPhotoPage() {
  return <ToolPlaceholder icon={ScanFace} title="证件照" hint="人脸定位、抠图换底、按规格裁剪压 KB、排版打印，全程本地处理。" />
}
