import { generate, parse, walk } from 'css-tree'
import { sanitizeStyle } from '@/lib/sanitizeHtml'

/** Keep document CSS inert until it has been parsed, filtered and scoped. */
export function scopeWordStyles(css: string, scope: string): string {
  const tree = parse(css, { parseCustomProperty: true })
  if (tree.type !== 'StyleSheet') return ''
  const rules: string[] = []
  tree.children.forEach((rule) => {
    // No @import, @font-face, nested at-rules or raw unparsed CSS.
    if (rule.type !== 'Rule' || rule.prelude?.type !== 'SelectorList') return
    const declarations: string[] = []
    rule.block.children.forEach((decl) => {
      if (decl.type !== 'Declaration') return
      let unsafe = false
      walk(decl.value, (node) => {
        if (node.type === 'Url' || node.type === 'Raw') unsafe = true
        if (node.type === 'Function' && !['var', 'calc', 'min', 'max', 'clamp', 'rgb', 'rgba', 'hsl', 'hsla', 'counter', 'counters'].includes(node.name.toLowerCase())) unsafe = true
      })
      if (unsafe) return
      const value = generate(decl.value)
      const text = `${decl.property}: ${value}`
      const extra = /^(--docx-[\w-]+|content|counter-reset|counter-increment)$/.test(decl.property)
      let clean = sanitizeStyle(text)
      if (!clean && extra) clean = text
      if (!clean) return
      // Absolute Word sizes must still follow the reader's font-size control.
      if (decl.property === 'font-size' && /^\d*\.?\d+(pt|px)$/.test(value)) {
        clean = `font-size: calc(${value} * var(--word-font-scale, 1))`
      }
      declarations.push(clean)
    })
    if (!declarations.length) return
    const selectors = rule.prelude.children.toArray().map((selector) => {
      const text = generate(selector)
      return text === ':root' ? `.${scope}` : `.${scope} ${text}`
    })
    rules.push(`${selectors.join(',')} { ${declarations.join('; ')} }`)
  })
  return rules.join('\n')
}
