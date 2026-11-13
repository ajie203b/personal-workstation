const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

function isDrawingNode(el: Element, local: string): boolean {
  if (el.localName !== local) return false
  return !el.namespaceURI || el.namespaceURI === DRAWINGML_NS || el.tagName.startsWith('a:')
}

function readParagraphText(paragraph: Element): string {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (isDrawingNode(el, 't')) {
      out += el.textContent ?? ''
      return
    }
    if (isDrawingNode(el, 'br')) {
      out += '\n'
      return
    }
    if (isDrawingNode(el, 'tab')) {
      out += ' '
      return
    }
    for (const child of Array.from(el.childNodes)) walk(child)
  }
  for (const child of Array.from(paragraph.childNodes)) walk(child)
  return out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

/**
 * Parse slide XML into paragraph strings via DOMParser so `<a:t xml:space="preserve">`
 * and XML entities (`&amp;`, `&lt;`, etc.) are decoded accurately.
 */
export function parsePptxSlideParagraphs(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) return []
  const paragraphs: string[] = []
  const seenParagraphs = new Set<Element>()

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (!isDrawingNode(el, 'p')) continue
    seenParagraphs.add(el)
    const text = readParagraphText(el)
    if (text) paragraphs.push(text)
  }

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (!isDrawingNode(el, 't')) continue
    let parent = el.parentElement
    let insideParagraph = false
    while (parent) {
      if (seenParagraphs.has(parent)) {
        insideParagraph = true
        break
      }
      parent = parent.parentElement
    }
    if (!insideParagraph) {
      const text = (el.textContent ?? '').replace(/[ \t]+/g, ' ').trim()
      if (text) paragraphs.push(text)
    }
  }

  return paragraphs
}
