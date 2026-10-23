const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/** Normalize valid OMML shapes missing from docx-preview 0.4's math parser. */
export async function prepareWordMath(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
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
  return changed ? zip.generateAsync({ type: 'arraybuffer' }) : buffer
}
