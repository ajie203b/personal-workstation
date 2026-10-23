import { expect, it } from 'vitest'
import { makePng } from './testPng'
import { pageInfo } from './layout'
import { signaturePlacementStamps, type SignaturePlacement } from './signaturePlacement'

it('不同签名分别导出，重复使用的签名共享字节且位置在页内', () => {
  const a = { id: 'a', name: 'A', dataUrl: `data:image/png;base64,${Buffer.from(makePng(8, 4, [0, 0, 0, 255])).toString('base64')}`, width: 8, height: 4, createdAt: 1 }
  const b = { ...a, id: 'b', dataUrl: `data:image/png;base64,${Buffer.from(makePng(8, 4, [255, 0, 0, 255])).toString('base64')}` }
  const place = (signature: typeof a): SignaturePlacement => ({ id: signature.id, signature, pageIndex: 0, nx: 1, ny: 1, nw: .2 })
  const stamps = signaturePlacementStamps([place(a), place(b), place(a)], [pageInfo(200, 300, 0)])
  expect(stamps[0].png).not.toEqual(stamps[1].png)
  expect(stamps[0].png).toBe(stamps[2].png)
  expect(stamps[0].rect.x + stamps[0].rect.w).toBeLessThanOrEqual(200)
  expect(stamps[0].rect.y + stamps[0].rect.h).toBeLessThanOrEqual(300)
})
