interface TableRow { text: string; end: number; suffix: string }
const TABLE_SEPARATOR = /^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|$/

/** Find actual cell delimiters, excluding escaped pipes and pipes inside code. */
function tablePipes(text: string): number[] {
  const positions: number[] = []
  let ticks = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue }
    if (text[i] === '`') {
      let length = 1
      while (text[i + length] === '`') length++
      if (!ticks) ticks = length
      else if (ticks === length) ticks = 0
      i += length - 1
    } else if (text[i] === '|' && !ticks) positions.push(i)
  }
  return positions
}

function readRow(lines: string[], start: number, limit: number, columns: number): TableRow | null {
  if (!/^ {0,3}\|/.test(lines[start] ?? '')) return null
  let text = ''
  for (let end = start; end < Math.min(limit, start + columns * 8 + 8); end++) {
    const part = lines[end].trim()
    if (/^(`{3,}|~{3,}|#{1,6}\s|>)/.test(part)) return null
    if (part) text += (text ? ' ' : '') + part
    const pipes = tablePipes(text)
    if (pipes.length > columns + 1) return null
    if (pipes.length !== columns + 1) continue
    const last = pipes[pipes.length - 1]
    const suffix = text.slice(last + 1).trim()
    if (suffix && !/^#{1,6}\s/.test(suffix)) return null
    const cells = pipes.slice(0, -1).map((position, i) => text.slice(position + 1, pipes[i + 1]).trim())
    return { text: `| ${cells.join(' | ')} |`, end: end + 1, suffix }
  }
  return null
}

/** Recover pasted pipe tables only when a matching GFM separator proves their shape. */
export function normalizeMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let fence: { char: string; length: number } | null = null
  let protectedUntil = 0
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length) fence = null
      protectedUntil = i + 1
    }
    const separator = lines[i].trim()
    if (fence || !TABLE_SEPARATOR.test(separator)) {
      output.push(lines[i]); continue
    }
    const columns = tablePipes(separator).length - 1
    let header: TableRow | null = null
    let headerStart = i
    for (let start = i - 1; start >= Math.max(protectedUntil, i - columns * 8 - 8); start--) {
      const candidate = readRow(lines, start, i, columns)
      if (candidate && !candidate.suffix && lines.slice(candidate.end, i).every((line) => !line.trim())) {
        header = candidate; headerStart = start; break
      }
    }
    if (!header) { output.push(lines[i]); continue }
    output.splice(output.length - (i - headerStart), i - headerStart, header.text, separator)
    let next = i + 1
    while (next < lines.length) {
      let start = next
      while (start < lines.length && !lines[start].trim()) start++
      const row = readRow(lines, start, lines.length, columns)
      if (!row) break
      let after = row.end
      while (after < lines.length && !lines[after].trim()) after++
      // A new header + separator after a gap belongs to a separate table.
      if (start > next && TABLE_SEPARATOR.test(lines[after]?.trim() ?? '')) break
      output.push(row.text)
      next = row.end
      if (row.suffix) { output.push('', row.suffix); break }
    }
    i = next - 1
  }
  return output.join('\n')
}
