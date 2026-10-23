const MATH_NS = 'http://www.w3.org/1998/Math/MathML'
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'dim', 'arg', 'softmax', 'sigmoid', 'relu'])

function mathElement(name: string, text?: string): Element {
  const element = document.createElementNS(MATH_NS, name)
  if (text !== undefined) element.textContent = text
  return element
}

function unwrapGroup(element: Element): Element {
  while (element.localName === 'mrow' && element.children.length === 1 && !element.attributes.length) element = element.children[0]
  return element
}

function normalizeEquation(math: Element): void {
  math.classList.add('word-math')
  // Word run sizes/fonts override MathML's script scaling and the bundled math font.
  for (const element of [math, ...Array.from(math.querySelectorAll('[style]'))]) {
    const style = element.getAttribute('style')
    if (!style) continue
    const holder = document.createElement('span')
    holder.setAttribute('style', style)
    for (const property of ['font-family', 'font-size', 'line-height', 'letter-spacing']) holder.style.removeProperty(property)
    if (holder.getAttribute('style')) element.setAttribute('style', holder.getAttribute('style')!)
    else element.removeAttribute('style')
  }
  // docx-preview emits every run as a string token; identifiers/operators need
  // their own MathML types for italic variables and proper mathematical spacing.
  for (const run of Array.from(math.querySelectorAll('ms'))) {
    if (run.children.length) continue
    const row = mathElement('mrow')
    for (const attribute of Array.from(run.attributes)) row.setAttribute(attribute.name, attribute.value)
    const tokens = (run.textContent ?? '').match(/[\p{L}\p{M}]+|\p{N}+(?:[.,]\p{N}+)?|\s+|./gu) ?? []
    for (const text of tokens) {
      let token: Element
      if (/^\p{N}/u.test(text)) token = mathElement('mn', text)
      else if (/^[\p{L}\p{M}]+$/u.test(text) && !/\p{Script=Han}/u.test(text)) {
        token = mathElement('mi', text)
        if (FUNCTIONS.has(text.toLowerCase())) token.setAttribute('mathvariant', 'normal')
        else if ([...text].length > 1) token.setAttribute('mathvariant', 'italic')
      } else if (/^[\p{S}\p{P}]$/u.test(text)) token = mathElement('mo', text)
      else token = mathElement('mtext', text)
      row.appendChild(token)
    }
    run.replaceWith(row)
  }
  // Script arguments are emitted as mn/mo containers even when they contain a
  // whole expression. MathML token elements cannot contain other math elements.
  for (const token of Array.from(math.querySelectorAll('mi,mn,mo,mtext'))) {
    if (!token.children.length) continue
    const row = mathElement('mrow')
    for (const attribute of Array.from(token.attributes)) row.setAttribute(attribute.name, attribute.value)
    row.append(...Array.from(token.childNodes))
    token.replaceWith(row)
  }
  // The OMML compatibility pass expands sSubSup. Restore one shared script
  // attachment so the superscript does not rise above an already subscripted box.
  for (const sup of Array.from(math.querySelectorAll('msup'))) {
    if (sup.children.length !== 2) continue
    const base = unwrapGroup(sup.children[0])
    if (base.localName !== 'msub' || base.children.length !== 2) continue
    const paired = mathElement('msubsup')
    for (const attribute of Array.from(sup.attributes)) paired.setAttribute(attribute.name, attribute.value)
    paired.append(...Array.from(base.children), sup.children[1])
    sup.replaceWith(paired)
  }
}

/** Give continuous Word reading a consistent hierarchy without discarding authored color/shading. */
export function normalizeWordTypography(root: HTMLElement): void {
  root.querySelectorAll('math').forEach(normalizeEquation)
  const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>('p'))
  for (const paragraph of paragraphs) {
    const heading = paragraph.className.match(/(?:^|\s)docx_(?:heading|标题)_?([1-6])(?:\s|$)/i)
    if (heading) paragraph.classList.add(`word-heading-${heading[1]}`)
    if (/(?:^|\s)docx_title(?:\s|$)/i.test(paragraph.className)) paragraph.classList.add('word-title')
    if (/(?:^|\s)docx_(?:caption|题注)(?:\s|$)/i.test(paragraph.className)) paragraph.classList.add('word-caption')
    const equations = Array.from(paragraph.querySelectorAll('math'))
    if (!equations.length) continue
    const outside = paragraph.cloneNode(true) as HTMLElement
    outside.querySelectorAll('math').forEach((element) => element.remove())
    const label = outside.textContent ?? ''
    const numbered = /^[\s\u00a0]*[（(]\s*[\dA-Za-z]+(?:[.\-]\d+)*\s*[）)][\s\u00a0]*$/.test(label)
    if (label.trim() && !numbered) continue
    paragraph.classList.add('word-equation-block')
    equations.forEach((equation) => equation.setAttribute('display', 'block'))
    const content = document.createElement('span')
    content.className = 'word-equation-content'
    if (numbered) {
      paragraph.classList.add('word-equation-numbered')
      content.append(...equations)
      const number = document.createElement('span')
      number.className = 'word-equation-number'
      number.append(...Array.from(paragraph.childNodes))
      paragraph.append(content, number)
    } else {
      content.append(...Array.from(paragraph.childNodes))
      paragraph.appendChild(content)
    }
  }
  const first = paragraphs.find((paragraph) => !paragraph.closest('table'))
  if (first && !first.querySelector('math') && (first.textContent?.trim().length ?? 0) < 100) {
    const isTitle = Array.from(first.querySelectorAll<HTMLElement>('[style]')).some((span) => {
      const size = span.style.fontSize
      return (size.endsWith('pt') ? parseFloat(size) >= 18 : size.endsWith('px') && parseFloat(size) >= 24)
    })
    if (isTitle) first.classList.add('word-title')
  }
}
