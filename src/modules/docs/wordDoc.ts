import { sanitizeHtml, sanitizeStyle } from '@/lib/sanitizeHtml'
import { uid } from '@/lib/id'
import type { FlowDoc, FlowTocItem } from './flowDoc'
import { scopeWordStyles } from './wordStyles'
import { prepareWordPackage } from './wordMath'
import { normalizeWordTypography } from './wordTypography'

const ABS_LEN_RE = /^(-?\d*\.?\d+)(pt|px|in|cm|mm|pc)$/i

function parseLengthPt(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const px = Number(trimmed)
    return px > 0 ? px * 0.75 : null
  }
  const m = trimmed.match(ABS_LEN_RE)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  switch (m[2].toLowerCase()) {
    case 'pt': return n
    case 'px': return n * 0.75
    case 'in': return n * 72
    case 'cm': return n * (72 / 2.54)
    case 'mm': return n * (72 / 25.4)
    case 'pc': return n * 12
    default: return null
  }
}

function isFixedLength(raw: string | null | undefined): boolean {
  if (!raw) return false
  return ABS_LEN_RE.test(raw.trim())
}

/**
 * Strip print-page geometry from docx-preview output so continuous reading
 * fills 100% of the chosen prose width without left-locking or right-clipping.
 */
export function normalizeWordLayout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('section.docx, section.docx > article').forEach((el) => {
    for (const prop of [
      'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
      'margin', 'margin-left', 'margin-right',
      'width', 'min-width', 'max-width', 'height', 'min-height',
    ]) {
      el.style.removeProperty(prop)
    }
  })

  // Normalize tables: docx-preview emits fixed pt widths on <table> and <col> even when
  // ignoreWidth=true, which locks callout cards & tables to ~453pt on wide screens and
  // clips their right side when prose width is narrowed.
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table'))) {
    table.removeAttribute('width')
    for (const prop of ['width', 'min-width', 'max-width', 'margin-left', 'margin-right']) {
      table.style.removeProperty(prop)
    }

    const colgroup = Array.from(table.children).find((el): el is HTMLTableColElement => el.tagName === 'COLGROUP')
    const cols = colgroup ? Array.from(colgroup.querySelectorAll<HTMLTableColElement>('col')) : []
    const rows = Array.from(table.rows)
    const maxRowCols = rows.reduce((max, row) => {
      const span = Array.from(row.cells).reduce((acc, c) => acc + (c.colSpan || 1), 0)
      return Math.max(max, span)
    }, 0)
    const colCount = Math.max(
      cols.reduce((acc, col) => acc + (col.span || 1), 0),
      maxRowCols,
    )

    if (cols.length === 1) {
      cols[0].removeAttribute('width')
      cols[0].style.width = '100%'
    } else if (cols.length > 1) {
      const parsed = cols.map((col) => parseLengthPt(col.style.width) ?? parseLengthPt(col.getAttribute('width')))
      const allValid = parsed.every((v): v is number => v != null && v > 0)
      const total = allValid ? parsed.reduce((a, b) => a + b, 0) : 0
      cols.forEach((col, i) => {
        col.removeAttribute('width')
        if (total > 0 && parsed[i] != null) {
          col.style.width = `${Number(((parsed[i]! / total) * 100).toFixed(2))}%`
        } else if (isFixedLength(col.style.width)) {
          col.style.removeProperty('width')
        }
      })
    }

    for (const cell of Array.from(table.querySelectorAll<HTMLElement>('tr, td, th'))) {
      cell.removeAttribute('width')
      if (isFixedLength(cell.style.width)) cell.style.removeProperty('width')
      if (isFixedLength(cell.style.minWidth)) cell.style.removeProperty('min-width')
    }

    const isSingleColumn = colCount <= 1 && rows.every((r) => r.cells.length <= 1)
    if (isSingleColumn) {
      table.classList.add('word-callout-table')
    } else if (colCount >= 4 && !table.parentElement?.closest('table, .word-table-scroll')) {
      const wrap = root.ownerDocument.createElement('div')
      wrap.className = 'word-table-scroll'
      table.parentNode?.insertBefore(wrap, table)
      wrap.appendChild(table)
    }
  }

  // Normalize Word drawing containers (<div style="width:..pt;height:..pt"><img/></div>)
  // so figures scale fluidly with aspect-ratio preserved instead of overflowing or squashing.
  for (const div of Array.from(root.querySelectorAll<HTMLDivElement>('div'))) {
    if (div.classList.contains('word-table-scroll')) continue
    const hasImg = Boolean(div.querySelector('img')) && !div.querySelector('p, table')
    if (hasImg) {
      const w = parseLengthPt(div.style.width)
      const h = parseLengthPt(div.style.height)
      if (w && h) {
        div.style.maxWidth = '100%'
        div.style.height = 'auto'
        div.style.setProperty('aspect-ratio', `${Number(w.toFixed(2))} / ${Number(h.toFixed(2))}`)
        if (w >= 180) div.classList.add('word-figure-box')
      } else if (isFixedLength(div.style.width)) {
        div.style.maxWidth = '100%'
        div.style.removeProperty('width')
      }
      div.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        img.removeAttribute('height')
        if (img.style.height === '100%') img.style.height = 'auto'
      })
    } else {
      if (isFixedLength(div.style.width)) div.style.removeProperty('width')
      if (isFixedLength(div.style.minWidth)) div.style.removeProperty('min-width')
    }
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('p, blockquote, figure, header, footer'))) {
    if (isFixedLength(el.style.width)) el.style.removeProperty('width')
    if (isFixedLength(el.style.minWidth)) el.style.removeProperty('min-width')
    if (el.tagName === 'P') {
      if (isFixedLength(el.style.lineHeight) || el.style.lineHeight) el.style.removeProperty('line-height')
      if (isFixedLength(el.style.minHeight)) el.style.removeProperty('min-height')
    }
  }
}

/** Render in detached containers: external document styles never enter the app unfiltered. */
export async function parseWordDoc(blob: Blob): Promise<FlowDoc> {
  const { renderAsync } = await import('docx-preview')
  const body = document.createElement('div')
  const styles = document.createElement('div')
  const { buffer, headingStyles } = await prepareWordPackage(await blob.arrayBuffer())
  await renderAsync(buffer, body, styles, {
    className: 'docx', inWrapper: false, breakPages: false,
    ignoreWidth: true, ignoreHeight: true, ignoreFonts: true,
    useBase64URL: true, renderAltChunks: false,
  })
  normalizeWordTypography(body, headingStyles)
  normalizeWordLayout(body)
  const scope = `word-${uid()}`
  const usedIds = new Set<string>()
  let headingIdx = 0
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p[class*="word-heading-"]'))) {
    const headingText = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!headingText) continue
    let id = el.id
    while (!id || usedIds.has(id)) id = `${scope}-h-${headingIdx++}`
    el.id = id
    usedIds.add(id)
  }
  body.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    element.setAttribute('style', sanitizeStyle(element.getAttribute('style') ?? ''))
    const size = element.style.fontSize
    if (/^\d*\.?\d+(pt|px)$/.test(size)) element.style.fontSize = `calc(${size} * var(--word-font-scale, 1))`
  })
  const html = sanitizeHtml(`<div class="${scope} word-content">${body.innerHTML}</div>`)
  const rendered = new DOMParser().parseFromString(html, 'text/html')
  const text = (rendered.body.textContent ?? '').replace(/[ \t]+/g, ' ').trim()
  if (!text && !rendered.querySelector('img,math')) throw new Error('DOCX 解析为空')
  const toc: FlowTocItem[] = []
  for (const el of Array.from(rendered.body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p[class*="word-heading-"]'))) {
    const title = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!title || !el.id) continue
    const classMatch = el.className.match(/word-heading-([1-6])/)
    const tagMatch = el.tagName.match(/^H([1-6])$/i)
    const levelNum = classMatch ? Number(classMatch[1]) : tagMatch ? Number(tagMatch[1]) : 1
    toc.push({ level: Math.max(0, levelNum - 1), title, anchor: `el:${el.id}` })
  }
  // The first sheet is the library's print-page reset (zero paragraph margins,
  // black text and flex pages). Reader typography replaces it; authored sheets stay.
  const css = Array.from(styles.querySelectorAll('style')).slice(1).map((style) => style.textContent ?? '').join('\n')
  return {
    unit: 'doc',
    segments: [{ title: '正文', html, text }],
    text,
    styles: scopeWordStyles(css, scope),
    toc: toc.length ? toc : undefined,
  }
}
