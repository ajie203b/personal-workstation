import type { SignatureRow } from '@/db/db'
import { dataUrlToBytes } from './signature'
import { placementRect, type PageInfo } from './layout'
import type { Stamp } from './pdfOps'

export interface SignaturePlacement {
  id: string
  pageIndex: number
  nx: number
  ny: number
  nw: number
  /** 放置时保留快照，之后切换/删除签名库项不会改变已放置内容。 */
  signature: SignatureRow
}

export function signaturePlacementStamps(placements: SignaturePlacement[], pages: PageInfo[]): Stamp[] {
  const cache = new Map<string, Uint8Array>()
  return placements.map(p => {
    const page = pages[p.pageIndex]
    if (!page) throw new Error('签名所在页面已不存在，请重新放置')
    let png = cache.get(p.signature.dataUrl)
    if (!png) { png = dataUrlToBytes(p.signature.dataUrl); cache.set(p.signature.dataUrl, png) }
    return { pageIndex: p.pageIndex, png, rect: placementRect(page.visW, page.visH, p.signature.width, p.signature.height, p) }
  })
}
