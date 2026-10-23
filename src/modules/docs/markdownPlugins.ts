import type { Root, Element } from 'hast'
import { defaultSchema } from 'rehype-sanitize'
import { sanitizeStyle } from '@/lib/sanitizeHtml'

export const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'u'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'],
    // Math is rendered after sanitation; only its source marker classes enter here.
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/, 'math-inline', 'math-display']],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'hl'],
    src: [...(defaultSchema.protocols?.src ?? []), 'data', 'blob'],
  },
}

/** The HTML schema admits styles; their declarations still use our reading whitelist. */
export function rehypeReaderStyles() {
  return (tree: Root) => {
    function walk(node: Root | Element) {
      if (node.type === 'element' && typeof node.properties.style === 'string') {
        const style = sanitizeStyle(node.properties.style)
        if (style) node.properties.style = style
        else delete node.properties.style
      }
      for (const child of node.children) if (child.type === 'element') walk(child)
    }
    walk(tree)
  }
}
