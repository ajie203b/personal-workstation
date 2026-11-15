import type { Doc } from '@/db/db'

export type CitationStyle = 'bibtex' | 'ris' | 'markdown'

function splitAuthors(value: string): string[] {
  const explicitSeparator = /[;；、\r\n]|\s+and\s+/i
  // 兼容旧的逗号分隔列表，同时保留「Vaswani, A.」一类姓名内的逗号。
  const separator = explicitSeparator.test(value) ? explicitSeparator : /[,，](?!\s*(?:\p{L}\.\s*)+(?:[,，]|$))/u
  return value.split(separator).map((author) => author.trim()).filter(Boolean)
}

function escapeBibTeX(value: string): string {
  return value.replace(/[{}&%_#$~^\\]/g, (char) => {
    if (char === '{') return '{\\textbraceleft}'
    if (char === '}') return '{\\textbraceright}'
    if (char === '~') return '{\\textasciitilde}'
    if (char === '^') return '{\\textasciicircum}'
    if (char === '\\') return '{\\textbackslash}'
    return `\\${char}`
  })
}

function citeKey(doc: Doc, firstAuthor = ''): string {
  const rawAuthor = firstAuthor.split(/[,，]/)[0]
  const asciiAuthor = rawAuthor.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'ref'
  const year = doc.meta?.year?.match(/\b\d{4}\b/)?.[0]
  return `${asciiAuthor}${year ?? '_nd'}_${doc.id.slice(0, 6)}`
}

export function formatCitation(doc: Doc, style: CitationStyle): string {
  const m = doc.meta
  const year = m?.year?.trim()
  const authors = splitAuthors(m?.author ?? '')
  if (style === 'bibtex') {
    const key = citeKey(doc, authors[0])
    const entryType = m?.venue ? 'article' : 'misc'
    const fields = [
      `  title = {${escapeBibTeX(doc.title)}}`,
      authors.length ? `  author = {${escapeBibTeX(authors.join(' and '))}}` : '',
      year ? `  year = {${escapeBibTeX(year)}}` : '',
      m?.venue ? `  journal = {${escapeBibTeX(m.venue)}}` : '',
      m?.doi ? `  doi = {${escapeBibTeX(m.doi)}}` : '',
      doc.sourceUrl ? `  url = {${doc.sourceUrl.replace(/[{}\\\s]/g, encodeURIComponent)}}` : '',
    ].filter(Boolean)
    return `@${entryType}{${key},\n${fields.join(',\n')}\n}`
  }

  if (style === 'ris') {
    const lines = [
      `TY  - ${m?.venue ? 'JOUR' : 'GEN'}`,
      `TI  - ${doc.title}`,
      ...authors.map((author) => `AU  - ${author}`),
      year ? `PY  - ${year}` : '',
      m?.venue ? `JO  - ${m.venue}` : '',
      m?.doi ? `DO  - ${m.doi}` : '',
      doc.sourceUrl ? `UR  - ${doc.sourceUrl}` : '',
      'ER  -',
    ].filter(Boolean)
    return lines.join('\n')
  }

  const metaParts = [m?.author, m?.year, m?.venue, m?.doi ? `DOI: ${m.doi}` : ''].filter(Boolean)
  const metaSuffix = metaParts.length ? ` (${metaParts.join(', ')})` : ''
  return `[${doc.title}](#/docs/${doc.id})${metaSuffix}`
}
