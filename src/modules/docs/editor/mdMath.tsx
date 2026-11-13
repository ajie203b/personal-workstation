import { useEffect, useRef, useState } from 'react'
import { Node } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import katex from 'katex'
import { Check, Copy } from 'lucide-react'
import { MermaidBlock } from '../MermaidBlock'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mdMath: {
      insertInlineMath: (latex?: string) => ReturnType
      insertMathBlock: (latex?: string) => ReturnType
    }
  }
}

interface MarkdownItToken {
  content: string
  attrSet: (name: string, val: string) => void
}

interface MarkdownItInlineState {
  src: string
  pos: number
  posMax: number
  push: (type: string, tag: string, nesting: number) => MarkdownItToken
}

interface MarkdownItBlockState {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  line: number
  push: (type: string, tag: string, nesting: number) => MarkdownItToken
}

interface MarkdownItLike {
  inline: {
    ruler: { before: (target: string, name: string, fn: (state: MarkdownItInlineState, silent: boolean) => boolean) => void }
  }
  block: {
    ruler: { before: (target: string, name: string, fn: (state: MarkdownItBlockState, start: number, end: number, silent: boolean) => boolean) => void }
  }
  renderer: {
    rules: Record<string, ((tokens: MarkdownItToken[], idx: number) => string) | undefined>
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function KatexPreview({ latex, displayMode, emptyHint }: { latex: string; displayMode: boolean; emptyHint: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!latex.trim()) {
      el.textContent = emptyHint
      return
    }
    try {
      katex.render(latex, el, { displayMode, throwOnError: false, output: 'htmlAndMathml' })
    } catch {
      el.textContent = latex
    }
  }, [latex, displayMode, emptyHint])
  return <span ref={ref} className={!latex.trim() ? 'text-on-surface-2 italic text-[12px]' : undefined} />
}

function InlineMathView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? '')
  const [editing, setEditing] = useState(() => latex === '')
  const [draft, setDraft] = useState(latex)

  useEffect(() => {
    setDraft(latex)
  }, [latex])

  const commit = (val: string) => {
    const next = val.trim()
    if (!next) {
      deleteNode()
      return
    }
    updateAttributes({ latex: next })
    setEditing(false)
  }

  return (
    <NodeViewWrapper as="span" className="relative inline-block align-baseline mx-0.5">
      <span
        contentEditable={false}
        onClick={(e) => {
          e.stopPropagation()
          setDraft(latex)
          setEditing(true)
        }}
        title="点击编辑公式"
        className={`inline-flex items-center px-1 py-0.5 rounded cursor-pointer transition-colors ${
          selected || editing ? 'bg-primary-soft ring-1 ring-primary/50' : 'bg-surface-2/80 hover:bg-primary-soft/60'
        }`}
      >
        <KatexPreview latex={latex} displayMode={false} emptyHint="公式" />
      </span>
      {editing && (
        <span
          contentEditable={false}
          className="absolute left-0 top-full mt-1 z-40 flex items-center gap-1.5 px-2 py-1.5 rounded-[10px] border border-outline bg-surface shadow-[var(--shadow-pop)]"
        >
          <span className="text-[11px] font-mono text-on-surface-2">$</span>
          <input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              updateAttributes({ latex: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                if (!draft.trim()) deleteNode()
                else setEditing(false)
              }
            }}
            onBlur={() => commit(draft)}
            placeholder="x^2 + y^2"
            aria-label="编辑行内公式 LaTeX"
            className="w-40 h-6 px-1.5 rounded bg-surface-2 border border-outline/80 font-mono text-[12px] outline-none focus:border-primary/60"
          />
          <span className="text-[11px] font-mono text-on-surface-2">$</span>
        </span>
      )}
    </NodeViewWrapper>
  )
}

function MathBlockView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? '')
  const [editing, setEditing] = useState(() => latex === '')
  const [draft, setDraft] = useState(latex)

  useEffect(() => {
    setDraft(latex)
  }, [latex])

  const commit = (val: string) => {
    const trimmed = val.trim()
    if (!trimmed) {
      deleteNode()
      return
    }
    updateAttributes({ latex: trimmed })
    setEditing(false)
  }

  return (
    <NodeViewWrapper
      as="div"
      className={`my-3 rounded-[10px] border transition-colors ${
        selected || editing ? 'border-primary/60 bg-surface-2/60' : 'border-outline/60 bg-surface-2/35 hover:border-primary/40'
      }`}
    >
      {editing && (
        <div contentEditable={false} className="p-2.5 border-b border-outline/60 flex flex-col gap-1.5 bg-surface-2/80 rounded-t-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-on-surface-2">$$ LaTeX 公式块</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => commit(draft)}
                className="h-6 px-2.5 rounded-[6px] bg-primary text-on-primary text-[11px] font-medium cursor-pointer"
              >
                完成
              </button>
            </div>
          </div>
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              updateAttributes({ latex: e.target.value })
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                commit(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                commit(draft)
              }
            }}
            placeholder="\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"
            aria-label="编辑块级公式 LaTeX"
            className="w-full rounded-[8px] bg-surface border border-outline px-2.5 py-2 font-mono text-[12.5px] outline-none focus:border-primary/60 resize-y"
          />
        </div>
      )}
      <div
        contentEditable={false}
        onClick={() => {
          setDraft(latex)
          setEditing(true)
        }}
        title="点击编辑公式块"
        className="px-4 py-3 text-center overflow-x-auto cursor-pointer"
      >
        <KatexPreview latex={latex} displayMode emptyHint="点击输入 LaTeX 公式块" />
      </div>
    </NodeViewWrapper>
  )
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'span[data-inline-math]',
      getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute('data-latex') ?? '' }),
    }]
  },

  renderHTML({ node }) {
    const latex = String(node.attrs.latex ?? '')
    return ['span', { 'data-inline-math': 'true', 'data-latex': latex }, `$${latex}$`]
  },

  addCommands() {
    return {
      insertInlineMath:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { latex?: string } }) {
          state.write(`$${String(node.attrs.latex ?? '')}$`)
        },
        parse: {
          setup(md: MarkdownItLike) {
            md.renderer.rules.md_inline_math = (tokens, idx) =>
              `<span data-inline-math="true" data-latex="${escapeAttr(tokens[idx].content)}"></span>`

            md.inline.ruler.before('escape', 'md_inline_math', (state, silent) => {
              const start = state.pos
              if (state.src.charCodeAt(start) !== 0x24) return false
              if (start > 0 && state.src.charCodeAt(start - 1) === 0x5c) return false
              if (state.src.charCodeAt(start + 1) === 0x24) return false

              let end = start + 1
              while (end < state.posMax) {
                const ch = state.src.charCodeAt(end)
                if (ch === 0x5c) {
                  end += 2
                  continue
                }
                if (ch === 0x0a) return false
                if (ch === 0x24 && state.src.charCodeAt(end + 1) !== 0x24) {
                  const raw = state.src.slice(start + 1, end)
                  if (!raw || /^\s/.test(raw) || /\s$/.test(raw)) return false
                  if (!silent) {
                    const tok = state.push('md_inline_math', 'span', 0)
                    tok.content = raw
                  }
                  state.pos = end + 1
                  return true
                }
                end++
              }
              return false
            })
          },
        },
      },
    }
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-math-block]',
      getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute('data-latex') ?? '' }),
    }]
  },

  renderHTML({ node }) {
    const latex = String(node.attrs.latex ?? '')
    return ['div', { 'data-math-block': 'true', 'data-latex': latex }, `$$\n${latex}\n$$`]
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (node: unknown) => void },
          node: { attrs: { latex?: string } },
        ) {
          state.write(`$$\n${String(node.attrs.latex ?? '')}\n$$`)
          state.closeBlock(node)
        },
        parse: {
          setup(md: MarkdownItLike) {
            md.renderer.rules.md_block_math = (tokens, idx) =>
              `<div data-math-block="true" data-latex="${escapeAttr(tokens[idx].content)}"></div>\n`

            md.block.ruler.before('fence', 'md_block_math', (state, startLine, endLine, silent) => {
              const startPos = state.bMarks[startLine] + state.tShift[startLine]
              const maxPos = state.eMarks[startLine]
              const firstLine = state.src.slice(startPos, maxPos).trim()
              if (!firstLine.startsWith('$$')) return false

              let latex: string
              let nextLine = startLine
              if (firstLine.length > 4 && firstLine.endsWith('$$')) {
                latex = firstLine.slice(2, -2).trim()
                nextLine = startLine + 1
              } else {
                const body: string[] = []
                const rest = firstLine.slice(2).trim()
                if (rest) body.push(rest)
                let closed = false
                for (let line = startLine + 1; line < endLine; line++) {
                  const s = state.bMarks[line] + state.tShift[line]
                  const e = state.eMarks[line]
                  const text = state.src.slice(s, e)
                  const trimmed = text.trim()
                  if (trimmed.endsWith('$$')) {
                    const beforeClose = trimmed.slice(0, -2).trim()
                    if (beforeClose) body.push(beforeClose)
                    nextLine = line + 1
                    closed = true
                    break
                  }
                  body.push(text)
                }
                if (!closed) return false
                latex = body.join('\n')
              }

              if (!silent) {
                const tok = state.push('md_block_math', 'div', 0)
                tok.content = latex
              }
              state.line = nextLine
              return true
            })
          },
        },
      },
    }
  },
})

const CODE_LANGUAGES = [
  ['', '纯文本'],
  ['mermaid', 'mermaid 图表'],
  ['typescript', 'TypeScript'],
  ['javascript', 'JavaScript'],
  ['python', 'Python'],
  ['rust', 'Rust'],
  ['json', 'JSON'],
  ['bash', 'Bash / Shell'],
  ['sql', 'SQL'],
  ['markdown', 'Markdown'],
  ['css', 'CSS'],
  ['html', 'HTML'],
] as const

function CodeBlockNodeView({ node, updateAttributes }: NodeViewProps) {
  const [copied, setCopied] = useState(false)
  const lang = String(node.attrs.language ?? '').trim().toLowerCase()
  const isMermaid = lang === 'mermaid'

  return (
    <NodeViewWrapper className="my-3 rounded-[10px] border border-outline/70 bg-[var(--md-code-bg,var(--surface-2))] overflow-hidden">
      <div
        contentEditable={false}
        className="flex items-center justify-between gap-2 px-3 py-1 border-b border-outline/50 bg-surface-2/80 text-[11px] text-on-surface-2"
      >
        <select
          aria-label="代码块语言"
          value={String(node.attrs.language ?? '')}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="h-6 px-1.5 rounded bg-transparent hover:bg-surface-3 text-[11px] font-mono outline-none cursor-pointer"
        >
          {CODE_LANGUAGES.map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(node.textContent).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
          className="h-6 px-2 rounded hover:bg-surface-3 inline-flex items-center gap-1 cursor-pointer"
        >
          {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="p-3 m-0 overflow-x-auto text-[13px] font-mono leading-relaxed">
        <code className="block"><NodeViewContent /></code>
      </pre>
      {isMermaid && node.textContent.trim() && (
        <div contentEditable={false} className="border-t border-outline/60 px-3 py-2 bg-surface">
          <MermaidBlock chart={node.textContent} />
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView)
  },
})
