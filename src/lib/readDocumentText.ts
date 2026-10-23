/** Imported text may come from Windows editors (GBK/UTF-16), not just UTF-8. */
export async function readDocumentText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let encoding: string | undefined
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
  else {
    // UTF-16 without a BOM: ASCII Markdown delimiters leave NULs in one byte lane.
    const size = Math.min(bytes.length, 4096)
    let evenNulls = 0
    let oddNulls = 0
    for (let i = 0; i < size; i++) {
      if (bytes[i] === 0) { if (i % 2) oddNulls++; else evenNulls++ }
    }
    if (oddNulls > size / 5 && evenNulls < size / 20) encoding = 'utf-16le'
    else if (evenNulls > size / 5 && oddNulls < size / 20) encoding = 'utf-16be'
  }
  let text: string
  if (encoding) text = new TextDecoder(encoding).decode(bytes)
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { text = new TextDecoder('gb18030').decode(bytes) }
  }
  return text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
}
