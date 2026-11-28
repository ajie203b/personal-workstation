import type { Doc } from '@/db/db'

export type CitationStyle = 'gbt7714' | 'apa' | 'mla' | 'bibtex' | 'ris' | 'markdown'

export const CITATION_STYLE_OPTIONS: readonly { value: CitationStyle; label: string }[] = [
  { value: 'gbt7714', label: 'GB/T 7714' },
  { value: 'apa', label: 'APA 7' },
  { value: 'mla', label: 'MLA 9' },
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'ris', label: 'RIS' },
  { value: 'markdown', label: 'Markdown' },
]

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

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

function formatGbt7714(doc: Doc, authors: string[], year?: string): string {
  const m = doc.meta
  const authorText = authors.length > 3
    ? `${authors.slice(0, 3).join(', ')}, ${hasCjk(authors[0]) ? '等' : 'et al'}`
    : authors.join(', ')
  const typeTag = m?.venue ? (doc.sourceUrl ? '[J/OL]' : '[J]') : doc.sourceUrl ? '[EB/OL]' : '[M]'
  const parts: string[] = []
  if (authorText) parts.push(`${authorText}.`)
  parts.push(`${doc.title}${typeTag}.`)
  const pub = [m?.venue?.trim(), year].filter(Boolean).join(', ')
  if (pub) parts.push(`${pub}.`)
  if (m?.doi?.trim()) parts.push(`DOI:${m.doi.trim()}.`)
  else if (doc.sourceUrl?.trim()) parts.push(doc.sourceUrl.trim())
  return parts.join(' ').trim()
}

function formatApa(doc: Doc, authors: string[], year?: string): string {
  const m = doc.meta
  let authorText = ''
  if (authors.length === 1) authorText = authors[0]
  else if (authors.length === 2) authorText = `${authors[0]} & ${authors[1]}`
  else if (authors.length > 2) authorText = `${authors.slice(0, -1).join(', ')}, & ${authors[authors.length - 1]}`
  const parts: string[] = []
  if (authorText) parts.push(authorText.endsWith('.') ? authorText : `${authorText}.`)
  parts.push(`(${year || 'n.d.'}).`)
  parts.push(`${doc.title}.`)
  if (m?.venue?.trim()) parts.push(`${m.venue.trim()}.`)
  if (m?.doi?.trim()) {
    const doi = m.doi.trim()
    parts.push(/^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`)
  } else if (doc.sourceUrl?.trim()) {
    parts.push(doc.sourceUrl.trim())
  }
  return parts.join(' ').trim()
}

function formatMla(doc: Doc, authors: string[], year?: string): string {
  const m = doc.meta
  let authorText = ''
  if (authors.length === 1) authorText = authors[0]
  else if (authors.length === 2) authorText = `${authors[0]}, and ${authors[1]}`
  else if (authors.length > 2) authorText = `${authors[0]}, et al.`
  const parts: string[] = []
  if (authorText) parts.push(authorText.endsWith('.') ? authorText : `${authorText}.`)
  parts.push(`"${doc.title}."`)
  const tail = [
    m?.venue?.trim(),
    year,
    m?.doi?.trim() ? `doi:${m.doi.trim()}` : doc.sourceUrl?.trim(),
  ].filter(Boolean).join(', ')
  if (tail) parts.push(`${tail}.`)
  return parts.join(' ').trim()
}

export function formatCitation(doc: Doc, style: CitationStyle): string {
  const m = doc.meta
  const year = m?.year?.trim()
  const authors = splitAuthors(m?.author ?? '')

  if (style === 'gbt7714') return formatGbt7714(doc, authors, year)
  if (style === 'apa') return formatApa(doc, authors, year)
  if (style === 'mla') return formatMla(doc, authors, year)

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
