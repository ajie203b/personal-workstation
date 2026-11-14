import type { Doc } from '@/db/db'

export type CitationStyle = 'bibtex' | 'ris' | 'markdown'

function splitAuthors(value: string): string[] {
  const explicitSeparator = /[;；、\r\n]|\s+and\s+/i
  // 兼容旧的逗号分隔列表，同时保留「Vaswani, A.」一类姓名内的逗号。
  const separator = explicitSeparator.test(value) ? explicitSeparator : /[,，](?!\s*(?:\p{L}\.\s*)+(?:[,，]|$))/u
  return value.split(separator).map((author) => author.trim()).filter(Boolean)
}

function escapeBibTeX(value: string): string {
  return value.replace(/[{}&%]/g, (char) => {
    if (char === '{') return '{\\textbraceleft}'
    if (char === '}') return '{\\textbraceright}'
    return `\\${char}`
  })
}

function citeKey(doc: Doc): string {
  const rawAuthor = doc.meta?.author?.split(/[,，;；、]/)[0]?.trim() ?? ''
  const asciiAuthor = rawAuthor.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'ref'
  const year = doc.meta?.year?.replace(/\D/g, '') || new Date(doc.addedAt).getFullYear().toString()
  return `${asciiAuthor}${year}_${doc.id.slice(0, 6)}`
}

export function formatCitation(doc: Doc, style: CitationStyle): string {
  const m = doc.meta
  const key = citeKey(doc)
  const year = m?.year?.trim() || String(new Date(doc.addedAt).getFullYear())
  const authors = splitAuthors(m?.author ?? '')
  if (style === 'bibtex') {
    const entryType = m?.venue ? 'article' : 'misc'
    const fields = [
      `  title = {${escapeBibTeX(doc.title)}}`,
      authors.length ? `  author = {${escapeBibTeX(authors.join(' and '))}}` : '',
      `  year = {${escapeBibTeX(year)}}`,
      m?.venue ? `  journal = {${escapeBibTeX(m.venue)}}` : '',
      m?.doi ? `  doi = {${escapeBibTeX(m.doi)}}` : '',
      doc.sourceUrl ? `  url = {${escapeBibTeX(doc.sourceUrl)}}` : '',
    ].filter(Boolean)
    return `@${entryType}{${key},\n${fields.join(',\n')}\n}`
  }

  if (style === 'ris') {
    const lines = [
      `TY  - ${m?.venue ? 'JOUR' : 'GEN'}`,
      `TI  - ${doc.title}`,
      ...authors.map((author) => `AU  - ${author}`),
      `PY  - ${year}`,
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
