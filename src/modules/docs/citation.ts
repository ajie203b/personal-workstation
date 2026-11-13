import type { Doc } from '@/db/db'

export type CitationStyle = 'bibtex' | 'ris' | 'markdown'

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
  if (style === 'bibtex') {
    const entryType = m?.venue ? 'article' : 'misc'
    const fields = [
      `  title = {${doc.title}}`,
      m?.author ? `  author = {${m.author}}` : '',
      `  year = {${year}}`,
      m?.venue ? `  ${entryType === 'article' ? 'journal' : 'howpublished'} = {${m.venue}}` : '',
      m?.doi ? `  doi = {${m.doi}}` : '',
      doc.sourceUrl ? `  url = {${doc.sourceUrl}}` : '',
    ].filter(Boolean)
    return `@${entryType}{${key},\n${fields.join(',\n')}\n}`
  }

  if (style === 'ris') {
    const lines = [
      `TY  - ${m?.venue ? 'JOUR' : 'GEN'}`,
      `TI  - ${doc.title}`,
      ...(m?.author ? m.author.split(/[,;，；、]/).map((a) => a.trim()).filter(Boolean).map((a) => `AU  - ${a}`) : []),
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
