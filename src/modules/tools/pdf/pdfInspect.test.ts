import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { inspectPdfEncryption } from './pdfInspect'
import { hasPdfEncryptMarker } from './qpdfTypes'
import { matchesFileAccept } from './parts'

describe('inspectPdfEncryption / hasPdfEncryptMarker', () => {
  it('普通未加密 PDF 返回 encrypted=false 且不误判 /EncryptMetadata', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 300])
    const bytes = await doc.save()
    expect(hasPdfEncryptMarker(bytes)).toBe(false)
    const res = await inspectPdfEncryption(bytes)
    expect(res.encrypted).toBe(false)
    expect(res.doc?.getPageCount()).toBe(1)
  })

  it('识别 /Type/XRef 无空格写法与 trailer << /Encrypt >> 直接字典', async () => {
    const xrefEnc = new TextEncoder().encode(
      '%PDF-1.5\n1 0 obj\n<< /Type/XRef /Size 2 /Encrypt 9 0 R >>\nstream\nabc\nendstream\nendobj\n%%EOF',
    )
    expect(hasPdfEncryptMarker(xrefEnc)).toBe(true)
    expect(await inspectPdfEncryption(xrefEnc)).toEqual({ encrypted: true })

    const trailerInline = new TextEncoder().encode(
      '%PDF-1.4\ntrailer << /Size 2 /Encrypt << /Filter /Standard /V 5 >> >>\nstartxref\n0\n%%EOF',
    )
    expect(hasPdfEncryptMarker(trailerInline)).toBe(true)
    expect(await inspectPdfEncryption(trailerInline)).toEqual({ encrypted: true })
  })

  it('损坏但非加密的 PDF 正常抛出异常，不误报为加密', async () => {
    const corrupt = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Broken >>\n%%EOF')
    expect(hasPdfEncryptMarker(corrupt)).toBe(false)
    await expect(inspectPdfEncryption(corrupt)).rejects.toThrow()
  })
})

describe('matchesFileAccept（拖放文件类型校验）', () => {
  it('支持 MIME、扩展名以及 MIME 为空时的扩展名回退', () => {
    expect(matchesFileAccept({ type: 'application/pdf', name: 'a.pdf' }, 'application/pdf,.pdf')).toBe(true)
    expect(matchesFileAccept({ type: '', name: 'report.PDF' }, 'application/pdf')).toBe(true)
    expect(matchesFileAccept({ type: 'text/plain', name: 'notes.txt' }, 'application/pdf,.pdf')).toBe(false)
    expect(matchesFileAccept({ type: '', name: 'photo.webp' }, 'image/*')).toBe(true)
    expect(matchesFileAccept({ type: 'image/png', name: 'seal.png' }, 'image/png')).toBe(true)
    expect(matchesFileAccept({ type: 'application/pdf', name: 'doc.pdf' }, 'image/*')).toBe(false)
  })
})
