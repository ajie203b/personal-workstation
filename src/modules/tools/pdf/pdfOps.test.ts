import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import { makePng } from './testPng'
import {
  applyPageOps,
  extractPages,
  imagesToPdf,
  mergePdfs,
  pageNumberText,
  pdfPageInfos,
  splitByGroups,
  stampPngs,
  watermarkStamps,
} from './pdfOps'

/** 造一份测试 PDF：每页尺寸都不一样（200+i × 300+i），方便校验页序 */
async function makeDoc(pages: number, rotations: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200 + i, 300 + i])
    if (rotations[i]) page.setRotation(degrees(rotations[i]))
  }
  return doc.save()
}

async function readInfo(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  return {
    count: doc.getPageCount(),
    pages: doc.getPages().map((p) => ({
      size: p.getSize(),
      rotation: p.getRotation().angle,
    })),
  }
}

describe('合并 / 拆分', () => {
  it('mergePdfs 按顺序拼页，尺寸能对上原页', async () => {
    const a = await makeDoc(2)
    const b = await makeDoc(3)
    const merged = await mergePdfs([a, b])
    const info = await readInfo(merged)
    expect(info.count).toBe(5)
    expect(info.pages.map((p) => p.size.width)).toEqual([200, 201, 200, 201, 202])
  })

  it('extractPages 保序提取，可打乱页序', async () => {
    const src = await makeDoc(4)
    const out = await extractPages(src, [3, 1])
    const info = await readInfo(out)
    expect(info.count).toBe(2)
    expect(info.pages.map((p) => p.size.width)).toEqual([202, 200])
  })

  it('extractPages 越界报错', async () => {
    const src = await makeDoc(3)
    await expect(extractPages(src, [4])).rejects.toThrow(/超出范围/)
  })

  it('splitByGroups 每段一份 PDF', async () => {
    const src = await makeDoc(5)
    const outs = await splitByGroups(src, [[1, 2], [3], [4, 5]])
    expect(outs).toHaveLength(3)
    const counts = []
    for (const o of outs) counts.push((await readInfo(o)).count)
    expect(counts).toEqual([2, 1, 2])
  })
})

describe('删页 / 旋转', () => {
  it('重排与删除、旋转一起生效', async () => {
    const out = await applyPageOps(await makeDoc(4), { order: [4, 2, 1, 3], remove: [2], rotate: { 4: 90 } })
    const info = await readInfo(out)
    expect(info.pages.map(p => p.size.width)).toEqual([203, 200, 202])
    expect(info.pages[0].rotation).toBe(90)
  })
  it('无效的重排不静默丢页', async () => {
    const input = await makeDoc(3)
    await expect(applyPageOps(input, { order: [1, 1, 3] })).rejects.toThrow(/页序/)
    await expect(applyPageOps(input, { order: [1, 2] })).rejects.toThrow(/页序/)
  })
  it('applyPageOps 删页后页数与页序正确', async () => {
    const src = await makeDoc(4)
    const out = await applyPageOps(src, { remove: [2, 3] })
    const info = await readInfo(out)
    expect(info.count).toBe(2)
    expect(info.pages.map((p) => p.size.width)).toEqual([200, 203])
  })

  it('applyPageOps 在原角度上追加旋转（mod 360）', async () => {
    const src = await makeDoc(2, [90, 0])
    const out = await applyPageOps(src, { rotate: { 1: 90, 2: 270 } })
    const info = await readInfo(out)
    expect(info.pages[0].rotation).toBe(180)
    expect(info.pages[1].rotation).toBe(270)
  })

  it('删光全部页面报错', async () => {
    const src = await makeDoc(2)
    await expect(applyPageOps(src, { remove: [1, 2] })).rejects.toThrow(/不能删掉全部页面/)
  })
})

describe('印章（水印 / 页码 / 签名同一通道）', () => {
  const png = makePng(8, 6, [200, 40, 40, 120])

  it('stampPngs 叠加后文档可读、页数不变', async () => {
    const src = await makeDoc(2)
    const infos = await pdfPageInfos(src)
    const stamps = watermarkStamps(png, 8, 6, infos, { position: 'tile', opacity: 0.3 })
    expect(stamps.length).toBeGreaterThan(2)
    const out = await stampPngs(src, stamps)
    const info = await readInfo(out)
    expect(info.count).toBe(2)
  })

  it('watermarkStamps 位置数量：居中 1 枚/页、四角 4 枚/页', async () => {
    const src = await makeDoc(2)
    const infos = await pdfPageInfos(src)
    expect(watermarkStamps(png, 8, 6, infos, { position: 'center', opacity: 0.5 })).toHaveLength(2)
    expect(watermarkStamps(png, 8, 6, infos, { position: 'corners', opacity: 0.5 })).toHaveLength(8)
    expect(infos[0].visW).toBe(200)
    expect(infos[0].visH).toBe(300)
  })

  it('旋转页上的印章同样可读', async () => {
    const src = await makeDoc(1, [90])
    const infos = await pdfPageInfos(src)
    expect(infos[0].visW).toBe(300)
    const stamps = watermarkStamps(png, 8, 6, infos, { position: 'corners', opacity: 1 })
    const out = await stampPngs(src, stamps)
    expect((await readInfo(out)).count).toBe(1)
  })

  it('页码文案三种格式', () => {
    expect(pageNumberText(0, 9, 'n')).toBe('1')
    expect(pageNumberText(6, 9, 'n/total')).toBe('7 / 9')
    expect(pageNumberText(2, 9, 'cn')).toBe('第 3 页')
  })
})

describe('图片转 PDF', () => {
  const png = makePng(40, 30, [30, 120, 220, 255])
  const img = { bytes: png, kind: 'png' as const, width: 40, height: 30 }

  it('native：页面 = 图 + 双倍边距', async () => {
    const out = await imagesToPdf([img], { size: 'native', margin: 10 })
    const info = await readInfo(out)
    expect(info.count).toBe(1)
    expect(info.pages[0].size.width).toBe(60)
    expect(info.pages[0].size.height).toBe(50)
  })

  it('a4 / fit 版式', async () => {
    const a4 = await readInfo(await imagesToPdf([img], { size: 'a4', margin: 0 }))
    expect(a4.pages[0].size.width).toBeCloseTo(595.28, 2)
    const fit = await readInfo(await imagesToPdf([img], { size: 'fit', margin: 20 }))
    expect(fit.pages[0].size.width).toBeCloseTo(595.28, 2)
    expect(fit.pages[0].size.height).toBeCloseTo((595.28 - 40) * (30 / 40) + 40, 1)
  })

  it('多图一页一张', async () => {
    const out = await imagesToPdf([img, img, img], { size: 'native', margin: 0 })
    expect((await readInfo(out)).count).toBe(3)
  })
})
