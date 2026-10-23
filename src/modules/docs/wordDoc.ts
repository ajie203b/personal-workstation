import { sanitizeHtml, sanitizeStyle } from '@/lib/sanitizeHtml'
import { uid } from '@/lib/id'
import type { FlowDoc } from './flowDoc'
import { scopeWordStyles } from './wordStyles'
import { prepareWordMath } from './wordMath'
import { normalizeWordTypography } from './wordTypography'

/** Render in detached containers: external document styles never enter the app unfiltered. */
export async function parseWordDoc(blob: Blob): Promise<FlowDoc> {
  const { renderAsync } = await import('docx-preview')
  const body = document.createElement('div')
  const styles = document.createElement('div')
  await renderAsync(await prepareWordMath(await blob.arrayBuffer()), body, styles, {
    className: 'docx', inWrapper: false, breakPages: false,
    ignoreWidth: true, ignoreHeight: true, ignoreFonts: true,
    useBase64URL: true, renderAltChunks: false,
  })
  normalizeWordTypography(body)
  // Continuous reading uses the available reader width rather than printed page margins.
  body.querySelectorAll<HTMLElement>('section.docx').forEach((section) => {
    for (const property of ['padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'width', 'height', 'min-height']) section.style.removeProperty(property)
  })
  body.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    element.setAttribute('style', sanitizeStyle(element.getAttribute('style') ?? ''))
    const size = element.style.fontSize
    if (/^\d*\.?\d+(pt|px)$/.test(size)) element.style.fontSize = `calc(${size} * var(--word-font-scale, 1))`
  })
  const scope = `word-${uid()}`
  const html = sanitizeHtml(`<div class="${scope} word-content">${body.innerHTML}</div>`)
  const rendered = new DOMParser().parseFromString(html, 'text/html')
  const text = (rendered.body.textContent ?? '').replace(/[ \t]+/g, ' ').trim()
  if (!text && !rendered.querySelector('img,math')) throw new Error('DOCX 解析为空')
  // The first sheet is the library's print-page reset (zero paragraph margins,
  // black text and flex pages). Reader typography replaces it; authored sheets stay.
  const css = Array.from(styles.querySelectorAll('style')).slice(1).map((style) => style.textContent ?? '').join('\n')
  return { unit: 'doc', segments: [{ title: '正文', html, text }], text, styles: scopeWordStyles(css, scope) }
}
