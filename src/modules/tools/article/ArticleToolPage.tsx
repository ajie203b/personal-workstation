import { Newspaper } from 'lucide-react'
import { ToolPlaceholder } from '../ToolPlaceholder'

/** 网页文章 → 离线文档 / EPUB（v3.3）——实现中，占位 */
export function ArticleToolPage() {
  return <ToolPlaceholder icon={Newspaper} title="文章离线" hint="粘贴链接抓正文，进文档库或导出 EPUB。" />
}
