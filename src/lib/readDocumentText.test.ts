import { describe, expect, it } from 'vitest'
import { readDocumentText } from './readDocumentText'

describe('document text decoding', () => {
  it('preserves UTF-8 Chinese, bold markers and emoji, and normalizes line endings', async () => {
    expect(await readDocumentText(new Blob(['\ufeff中文 **粗体** 🙂\r\n下一行\r末行'])))
      .toBe('中文 **粗体** 🙂\n下一行\n末行')
  })

  it('reads GBK Markdown without replacement characters', async () => {
    const bytes = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 32, 42, 42, 0xb4, 0xd6, 0xcc, 0xe5, 42, 42])
    expect(await readDocumentText(new Blob([bytes]))).toBe('中文 **粗体**')
  })

  it.each([true, false])('reads UTF-16 with a byte-order mark (little endian: %s)', async (little) => {
    const text = '# 中文 **粗体**'
    const bytes = new Uint8Array((text.length + 1) * 2)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 0xfeff, little)
    for (let i = 0; i < text.length; i++) view.setUint16((i + 1) * 2, text.charCodeAt(i), little)
    expect(await readDocumentText(new Blob([bytes]))).toBe(text)
  })
})
