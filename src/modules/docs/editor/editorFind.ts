import { Extension, type Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface EditorFindMatch {
  from: number
  to: number
}

export interface EditorFindState {
  query: string
  activeIndex: number
  caseSensitive: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    editorFind: {
      setEditorFind: (next: Partial<EditorFindState>) => ReturnType
    }
  }
}

export const EDITOR_FIND_KEY = new PluginKey<EditorFindState>('editorFind')

export function findMatchesInDoc(doc: PmNode, query: string, caseSensitive = false): EditorFindMatch[] {
  const q = query
  if (!q) return []
  const needle = caseSensitive ? q : q.toLowerCase()
  const out: EditorFindMatch[] = []

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    let text = ''
    const charPositions: number[] = []
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return
      const startPos = pos + 1 + offset
      for (let i = 0; i < child.text.length; i++) {
        text += child.text[i]
        charPositions.push(startPos + i)
      }
    })
    if (!text) return false
    const hay = caseSensitive ? text : text.toLowerCase()
    let idx = hay.indexOf(needle)
    while (idx !== -1) {
      const from = charPositions[idx]
      const to = charPositions[idx + needle.length - 1] + 1
      out.push({ from, to })
      idx = hay.indexOf(needle, idx + Math.max(1, needle.length))
    }
    return false
  })
  return out
}

export function findTextMatches(source: string, query: string, caseSensitive = false): { start: number; end: number }[] {
  if (!query) return []
  const hay = caseSensitive ? source : source.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: { start: number; end: number }[] = []
  let idx = hay.indexOf(needle)
  while (idx !== -1) {
    out.push({ start: idx, end: idx + needle.length })
    idx = hay.indexOf(needle, idx + Math.max(1, needle.length))
  }
  return out
}

export function replaceOneInEditor(editor: Editor, match: EditorFindMatch, replacement: string): boolean {
  const { tr } = editor.state
  tr.insertText(replacement, match.from, match.to)
  editor.view.dispatch(tr)
  return true
}

export function replaceAllInEditor(editor: Editor, matches: readonly EditorFindMatch[], replacement: string): number {
  if (!matches.length) return 0
  const { tr } = editor.state
  // 从后向前替换，避免偏移错位
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    tr.insertText(replacement, m.from, m.to)
  }
  editor.view.dispatch(tr)
  return matches.length
}

export const EditorFindExtension = Extension.create({
  name: 'editorFind',

  addCommands() {
    return {
      setEditorFind:
        (next) =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(state.tr.setMeta(EDITOR_FIND_KEY, next))
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<EditorFindState>({
        key: EDITOR_FIND_KEY,
        state: {
          init: () => ({ query: '', activeIndex: 0, caseSensitive: false }),
          apply(tr, prev) {
            const meta = tr.getMeta(EDITOR_FIND_KEY) as Partial<EditorFindState> | undefined
            if (!meta) return prev
            return {
              query: meta.query ?? prev.query,
              activeIndex: meta.activeIndex ?? prev.activeIndex,
              caseSensitive: meta.caseSensitive ?? prev.caseSensitive,
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = EDITOR_FIND_KEY.getState(state)
            if (!pluginState?.query) return DecorationSet.empty
            const matches = findMatchesInDoc(state.doc, pluginState.query, pluginState.caseSensitive)
            if (!matches.length) return DecorationSet.empty
            const safeActive = Math.min(Math.max(0, pluginState.activeIndex), matches.length - 1)
            const decs = matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === safeActive ? 'find-hit find-hit-active' : 'find-hit',
              }),
            )
            return DecorationSet.create(state.doc, decs)
          },
        },
      }),
    ]
  },
})
