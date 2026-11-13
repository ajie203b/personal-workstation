import { sanitizeHtml, sanitizeStyle } from '@/lib/sanitizeHtml'
import { uid } from '@/lib/id'
import type { FlowDoc, FlowTocItem } from './flowDoc'
import { scopeWordStyles } from './wordStyles'
import { prepareWordPackage } from './wordMath'
import { normalizeWordTypography } from './wordTypography'

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
  // Continuous reading uses the available reader width rather than printed page margins.
  body.querySelectorAll<HTMLElement>('section.docx').forEach((section) => {
    for (const property of ['padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'width', 'height', 'min-height']) section.style.removeProperty(property)
  })
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
