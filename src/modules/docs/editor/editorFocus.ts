import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface TyporaModesState {
  focusMode: boolean
  typewriterMode: boolean
}

export interface EditorFocusOptions {
  scrollRef?: { current: HTMLElement | null }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    typoraModes: {
      setTyporaModes: (next: Partial<TyporaModesState>) => ReturnType
    }
  }
}

export const TYPORA_MODES_KEY = new PluginKey<TyporaModesState>('typoraModes')

export const EditorFocusExtension = Extension.create<EditorFocusOptions>({
  name: 'typoraModes',

  addOptions() {
    return {
      scrollRef: undefined,
    }
  },

  addCommands() {
    return {
      setTyporaModes:
        (next) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(state.tr.setMeta(TYPORA_MODES_KEY, next))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const getScrollContainer = () => this.options.scrollRef?.current ?? null
    let rafId: number | null = null

    return [
      new Plugin<TyporaModesState>({
        key: TYPORA_MODES_KEY,
        state: {
          init: () => ({ focusMode: false, typewriterMode: false }),
          apply(tr, prev) {
            const meta = tr.getMeta(TYPORA_MODES_KEY) as Partial<TyporaModesState> | undefined
            if (!meta) return prev
            return {
              focusMode: meta.focusMode ?? prev.focusMode,
              typewriterMode: meta.typewriterMode ?? prev.typewriterMode,
            }
          },
        },
        view() {
          return {
            update(view, prevState) {
              const mode = TYPORA_MODES_KEY.getState(view.state)
              if (!mode?.typewriterMode || !view.hasFocus()) return
              const selChanged = !prevState.selection.eq(view.state.selection) || prevState.doc !== view.state.doc
              if (!selChanged) return
              const scroller = getScrollContainer()
              if (!scroller) return
              if (rafId != null) cancelAnimationFrame(rafId)
              rafId = requestAnimationFrame(() => {
                rafId = null
                try {
                  const coords = view.coordsAtPos(view.state.selection.head)
                  const box = scroller.getBoundingClientRect()
                  const targetY = box.top + box.height * 0.42
                  const delta = coords.top - targetY
                  if (Math.abs(delta) > 14) {
                    scroller.scrollTop = Math.max(0, scroller.scrollTop + delta)
                  }
                } catch {
                  /* ignore invalid pos */
                }
              })
            },
            destroy() {
              if (rafId != null) cancelAnimationFrame(rafId)
            },
          }
        },
        props: {
          decorations(state) {
            const mode = TYPORA_MODES_KEY.getState(state)
            if (!mode?.focusMode) return DecorationSet.empty
            const { $from } = state.selection
            if ($from.depth < 1) return DecorationSet.empty
            const start = $from.before(1)
            const end = $from.after(1)
            return DecorationSet.create(state.doc, [
              Decoration.node(start, end, { class: 'typora-focus-active' }),
            ])
          },
        },
      }),
    ]
  },
})
