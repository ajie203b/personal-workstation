import { Mark, mergeAttributes } from '@tiptap/core'

export const HL_COLORS = ['yellow', 'green', 'blue', 'red'] as const
export type HlColor = (typeof HL_COLORS)[number]

const COLOR_SET = new Set<string>(HL_COLORS)

/**
 * 自写文档的高亮：存成 `==yellow|文字==`，不依赖 HTML 模式。
 * TipTap 里渲染成 <mark class="hl-yellow">，阅读器由 remarkHighlight 还原。
 */
export const HighlightMark = Mark.create({
  name: 'hl',
  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (el) => (COLOR_SET.has(el.getAttribute('data-color') ?? '') ? el.getAttribute('data-color') : 'yellow'),
        renderHTML: (attrs) => ({ 'data-color': attrs.color }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'mark[data-color]' }]
  },
  renderHTML({ HTMLAttributes }) {
    const color = String(HTMLAttributes['data-color'] ?? 'yellow')
    return ['mark', mergeAttributes(HTMLAttributes, { class: `hl-${color}` }), 0]
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color?: string } }) =>
            `==${COLOR_SET.has(mark.attrs.color ?? '') ? mark.attrs.color : 'yellow'}|`,
          close: () => '==',
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup(md: {
            inline: { ruler: { before: (name: string, rule: string, fn: unknown) => void }; tokenize: (state: unknown) => void }
          }) {
            md.inline.ruler.before('emphasis', 'md_hl', (state: InlineState, silent: boolean) => {
              const start = state.pos
              if (state.src.charCodeAt(start) !== 0x3d || state.src.charCodeAt(start + 1) !== 0x3d) return false
              const m = state.src.slice(start).match(/^==(yellow|green|blue|red)\|/)
              if (!m) return false
              const contentStart = start + m[0].length
              const end = state.src.indexOf('==', contentStart)
              if (end <= contentStart) return false
              if (!silent) {
                const open = state.push('md_hl_open', 'mark', 1)
                open.attrSet('data-color', m[1])
                const oldMax = state.posMax
                state.pos = contentStart
                state.posMax = end
                state.md.inline.tokenize(state)
                state.posMax = oldMax
                state.push('md_hl_close', 'mark', -1)
              }
              state.pos = end + 2
              return true
            })
          },
        },
      },
    }
  },
})

interface InlineState {
  pos: number
  posMax: number
  src: string
  md: { inline: { tokenize: (state: InlineState) => void } }
  push: (type: string, tag: string, nesting: number) => { attrSet: (name: string, value: string) => void }
}

const HL_TEXT = /==(yellow|green|blue|red)\|([\s\S]+?)==/g

/** 把 `==color|文字==` 还原成 mark：供 MdReader 的 remark 插件使用 */
export function remarkHighlight() {
  return (tree: unknown) => {
    walk(tree)
  }
}

function walk(node: unknown) {
  const n = node as { children?: unknown[]; type?: string }
  if (!n.children) return
  const out: unknown[] = []
  for (const child of n.children) {
    const c = child as { type?: string; value?: string; children?: unknown[] }
    if (c.type === 'text' && typeof c.value === 'string' && c.value.includes('==')) {
      out.push(...splitText(c.value))
    } else {
      // 代码块 / 行内代码里的 == 不是高亮
      if (c.type !== 'code' && c.type !== 'inlineCode') walk(child)
      out.push(child)
    }
  }
  n.children = out
}

function splitText(text: string): unknown[] {
  const out: unknown[] = []
  let last = 0
  for (const m of text.matchAll(HL_TEXT)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) })
    out.push({
      type: 'link',
      url: `hl:${m[1]}`,
      title: null,
      children: [{ type: 'text', value: m[2] }],
    })
    last = idx + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out.length ? out : [{ type: 'text', value: text }]
}
