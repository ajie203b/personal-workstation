// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildArticleEpub, dataUrlToBytes } from './articleEpub'

/** 1×1 PNG */
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const INPUT = {
  title: 'EPUB 测试文章',
  byline: '作者甲',
  sourceUrl: 'https://blog.test/posts/1',
  capturedAt: new Date(2026, 9, 22, 15, 30).getTime(),
  contentHtml: '<p>正文含特殊字符 &amp; 与标签 &lt;code&gt;。</p><img src="' + PNG_1PX + '" alt="图">',
}

/** 读 zip 第一个本地文件头：名称 + 压缩方式（0 = STORE 不压缩） */
function firstZipEntry(bytes: Uint8Array): { name: string; compression: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x04034b50) // 本地文件头签名 PK\x03\x04
  const compression = view.getUint16(8, true)
  const nameLen = view.getUint16(26, true)
  const name = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen))
  return { name, compression }
}

describe('dataUrlToBytes', () => {
  it('解出字节与 MIME', () => {
    const r = dataUrlToBytes(PNG_1PX)
    expect(r?.mime).toBe('image/png')
    expect(Array.from(r!.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(dataUrlToBytes('https://a.test/1.png')).toBeNull()
    expect(dataUrlToBytes('data:image/png;base64,!!!')).toBeNull()
  })
})

describe('buildArticleEpub', () => {
  it('zip 结构合规：mimetype 是第一个条目且 STORE 不压缩', async () => {
    const blob = await buildArticleEpub(INPUT)
    expect(blob.type).toBe('application/epub+zip')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const first = firstZipEntry(bytes)
    expect(first.name).toBe('mimetype')
    expect(first.compression).toBe(0)

    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    // Object.keys 的顺序即 zip 条目顺序
    expect(Object.keys(zip.files)[0]).toBe('mimetype')
    expect(await zip.file('mimetype')?.async('string')).toBe('application/epub+zip')
    expect(zip.file('META-INF/container.xml')).toBeTruthy()
    expect(zip.file('OEBPS/content.opf')).toBeTruthy()
    expect(zip.file('OEBPS/nav.xhtml')).toBeTruthy()
    expect(zip.file('OEBPS/article.xhtml')).toBeTruthy()
  })

  it('正文走 XMLSerializer 序列化成合法 XHTML，特殊字符被转义', async () => {
    const blob = await buildArticleEpub(INPUT)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xhtml = await zip.file('OEBPS/article.xhtml')?.async('string')
    expect(xhtml).toBeTruthy()
    expect(xhtml!.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true)

    // 再解析一遍：parsererror = 序列化出了非法 XML
    const doc = new DOMParser().parseFromString(xhtml!, 'application/xhtml+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('h1')?.textContent).toBe('EPUB 测试文章')
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://blog.test/posts/1')
    // 特殊字符以文本形式存活（转义被序列化器接管）
    expect(doc.body.textContent).toContain('正文含特殊字符 & 与标签 <code>。')
  })

  it('dataURL 图片落盘为独立文件并进 manifest', async () => {
    const blob = await buildArticleEpub(INPUT)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const img = zip.file('OEBPS/images/img-1.png')
    expect(img).toBeTruthy()
    const imgBytes = await img!.async('uint8array')
    expect(Array.from(imgBytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])

    const xhtml = await zip.file('OEBPS/article.xhtml')?.async('string')
    expect(xhtml).toContain('src="images/img-1.png"')
    expect(xhtml).not.toContain('data:image') // 正文里不再挂 dataURL

    const opf = await zip.file('OEBPS/content.opf')?.async('string')
    expect(opf).toContain('href="images/img-1.png"')
    expect(opf).toContain('media-type="image/png"')
  })

  it('外链图不落盘，原样保留', async () => {
    const blob = await buildArticleEpub({
      ...INPUT,
      contentHtml: '<p>外链图</p><img src="https://cdn.example.com/pic.png">',
    })
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('OEBPS/images/img-1.png')).toBeNull()
    const xhtml = await zip.file('OEBPS/article.xhtml')?.async('string')
    expect(xhtml).toContain('https://cdn.example.com/pic.png')
  })
})
