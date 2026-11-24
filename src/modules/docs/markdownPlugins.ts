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

const FLUID_HTML_BLOCKS = new Set([
  'div', 'section', 'article', 'aside', 'header', 'footer', 'blockquote', 'figure', 'p', 'table', 'tr', 'td', 'th',
])
const FIXED_WIDTH_DECL_RE = /^(?:width|min-width)\s*:\s*-?\d*\.?\d+(?:pt|px|in|cm|mm|pc)\s*$/i

/** The HTML schema admits styles; their declarations still use our reading whitelist. */
export function rehypeReaderStyles() {
  return (tree: Root) => {
    function walk(node: Root | Element) {
      if (node.type === 'element') {
        const tag = node.tagName.toLowerCase()
        if ((tag === 'table' || tag === 'td' || tag === 'th') && 'width' in node.properties) {
          delete node.properties.width
        }
        if (typeof node.properties.style === 'string') {
          let style = sanitizeStyle(node.properties.style)
          if (style && FLUID_HTML_BLOCKS.has(tag)) {
            style = style
              .split(';')
              .map((d) => d.trim())
              .filter((d) => d && !FIXED_WIDTH_DECL_RE.test(d))
              .join('; ')
          }
          if (style) node.properties.style = style
          else delete node.properties.style
        }
      }
      for (const child of node.children) if (child.type === 'element') walk(child)
    }
    walk(tree)
  }
}
