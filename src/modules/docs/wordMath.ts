const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function wordAttr(el: Element, name: string): string | null {
  return el.getAttributeNS(WORD_NS, name) ?? el.getAttribute(`w:${name}`) ?? el.getAttribute(name)
}

function escapeStyleClass(styleId: string): string {
  return styleId.replace(/[ .]+/g, '-').replace(/[&]+/g, 'and').toLowerCase()
}

function headingLevelFromName(name: string | null): number | null {
  if (!name) return null
  const m = name.trim().match(/^(?:heading|标题)\s*_?\s*([1-6])$/i)
  return m ? Number(m[1]) : null
}

export function extractWordHeadingStyles(stylesXml: string): Map<string, number> {
  const xml = new DOMParser().parseFromString(stylesXml, 'application/xml')
  const direct = new Map<string, number>()
  const basedOn = new Map<string, string>()
  const styleIds: string[] = []

  for (const style of Array.from(xml.getElementsByTagName('*'))) {
    if (style.localName !== 'style') continue
    if (wordAttr(style, 'type') !== 'paragraph') continue
    const id = wordAttr(style, 'styleId')
    if (!id) continue
    styleIds.push(id)

    let name: string | null = null
    let base: string | null = null
    let outline: number | null = null
    for (const child of Array.from(style.children)) {
      if (child.localName === 'name') name = wordAttr(child, 'val')
      else if (child.localName === 'basedOn') base = wordAttr(child, 'val')
      else if (child.localName === 'pPr') {
        for (const prop of Array.from(child.children)) {
          if (prop.localName === 'outlineLvl') {
            const raw = wordAttr(prop, 'val')
            const lvl = raw != null ? Number(raw) : NaN
            if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 5) outline = lvl + 1
          }
        }
      }
    }
    const lvl = headingLevelFromName(name) ?? outline ?? headingLevelFromName(id)
    if (lvl) direct.set(id, lvl)
    if (base) basedOn.set(id, base)
  }

  const resolve = (id: string, seen = new Set<string>()): number | null => {
    if (direct.has(id)) return direct.get(id)!
    if (seen.has(id)) return null
    seen.add(id)
    const parent = basedOn.get(id)
    return parent ? resolve(parent, seen) : null
  }

  const out = new Map<string, number>()
  for (const id of styleIds) {
    const lvl = resolve(id)
    if (lvl) out.set(`docx_${escapeStyleClass(id)}`, lvl)
  }
  return out
}

/** Normalize valid OMML shapes missing from docx-preview 0.4's math parser and collect heading style classes. */
export async function prepareWordPackage(buffer: ArrayBuffer): Promise<{ buffer: ArrayBuffer; headingStyles: Map<string, number> }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  let headingStyles = new Map<string, number>()
  const stylesFile = zip.file('word/styles.xml')
  if (stylesFile) {
    try {
      headingStyles = extractWordHeadingStyles(await stylesFile.async('string'))
    } catch {
      headingStyles = new Map()
    }
  }
  let changed = false
  for (const path of Object.keys(zip.files).filter((name) => /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(name))) {
    const source = await zip.file(path)!.async('string')
    if (!source.includes(MATH_NS)) continue
    const xml = new DOMParser().parseFromString(source, 'application/xml')
    let patched = false
    const create = (name: string) => xml.createElementNS(MATH_NS, `m:${name}`)
    const child = (node: Element, name: string) => Array.from(node.children).find((element) => element.namespaceURI === MATH_NS && element.localName === name)
    // A nested subscript + superscript is equivalent to the unsupported sSubSup.
    for (const script of Array.from(xml.getElementsByTagNameNS(MATH_NS, 'sSubSup')).reverse()) {
      const base = child(script, 'e')
      const sub = child(script, 'sub')
      const sup = child(script, 'sup')
      if (!base || !sub || !sup) continue
      const replacement = create('sSup')
      const outerBase = create('e')
      const subscript = create('sSub')
      subscript.append(base, sub)
      outerBase.appendChild(subscript)
      replacement.append(outerBase, sup)
      script.replaceWith(replacement)
      patched = true
    }
    for (const node of Array.from(xml.getElementsByTagNameNS(MATH_NS, '*'))) {
      const name = node.localName
      // Optional OMML properties must still exist for the renderer's default values.
      if (['d', 'groupChr', 'bar'].includes(name) && !child(node, `${name}Pr`)) {
        node.prepend(create(`${name}Pr`)); patched = true
      }
      if (name === 'rad' && !child(node, 'deg')?.textContent?.trim()) {
        let properties = child(node, 'radPr')
        if (!properties) { properties = create('radPr'); node.prepend(properties) }
        if (!child(properties, 'degHide')) {
          const hide = create('degHide')
          hide.setAttributeNS(MATH_NS, 'm:val', '1')
          properties.appendChild(hide); patched = true
        }
      }
      // The renderer expects both limit slots, even when only one is visible.
      if (name === 'nary' || name === 'sPre') {
        for (const slot of ['sub', 'sup']) if (!child(node, slot)) {
          node.appendChild(create(slot)); patched = true
        }
      }
    }
    if (patched) {
      zip.file(path, new XMLSerializer().serializeToString(xml))
      changed = true
    }
  }
  return {
    buffer: changed ? await zip.generateAsync({ type: 'arraybuffer' }) : buffer,
    headingStyles,
  }
}

export async function prepareWordMath(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  return (await prepareWordPackage(buffer)).buffer
}
