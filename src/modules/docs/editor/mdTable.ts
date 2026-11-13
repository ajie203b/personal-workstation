import { Node, mergeAttributes } from '@tiptap/core'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  tableEditing,
} from '@tiptap/pm/tables'
import type { EditorState, Transaction } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mdTable: {
      insertGfmTable: (opts?: { rows?: number; cols?: number }) => ReturnType
      addTableRowBefore: () => ReturnType
      addTableRowAfter: () => ReturnType
      deleteTableRow: () => ReturnType
      addTableColumnBefore: () => ReturnType
      addTableColumnAfter: () => ReturnType
      deleteTableColumn: () => ReturnType
      deleteGfmTable: () => ReturnType
    }
  }
}

export function isCursorInTable(state: EditorState): boolean {
  return isInTable(state)
}

function wrapPmCommand(pmCmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => pmCmd(state, dispatch)
}

export const MdTableCell = Node.create({
  name: 'tableCell',
  content: 'paragraph+',
  isolating: true,
  extendNodeSchema(extension) {
    return extension.name === 'tableCell' ? { tableRole: 'cell' } : {}
  },
  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    }
  },
  parseHTML() {
    return [{ tag: 'td' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['td', mergeAttributes(HTMLAttributes), 0]
  },
})

export const MdTableHeader = Node.create({
  name: 'tableHeader',
  content: 'paragraph+',
  isolating: true,
  extendNodeSchema(extension) {
    return extension.name === 'tableHeader' ? { tableRole: 'header_cell' } : {}
  },
  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    }
  },
  parseHTML() {
    return [{ tag: 'th' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['th', mergeAttributes(HTMLAttributes), 0]
  },
})

export const MdTableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)+',
  extendNodeSchema(extension) {
    return extension.name === 'tableRow' ? { tableRole: 'row' } : {}
  },
  parseHTML() {
    return [{ tag: 'tr' }]
  },
  renderHTML() {
    return ['tr', 0]
  },
})

export const MdTable = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  extendNodeSchema(extension) {
    return extension.name === 'table' ? { tableRole: 'table' } : {}
  },

  parseHTML() {
    return [{ tag: 'table' }]
  },

  renderHTML() {
    return ['table', ['tbody', 0]]
  },

  addProseMirrorPlugins() {
    return [tableEditing()]
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => wrapPmCommand(goToNextCell(1))({ state: this.editor.state, dispatch: this.editor.view.dispatch }),
      'Shift-Tab': () => wrapPmCommand(goToNextCell(-1))({ state: this.editor.state, dispatch: this.editor.view.dispatch }),
    }
  },

  addCommands() {
    return {
      insertGfmTable:
        (opts) =>
        ({ commands }) => {
          const rows = Math.max(2, opts?.rows ?? 3)
          const cols = Math.max(1, opts?.cols ?? 3)
          const headerRow = {
            type: 'tableRow',
            content: Array.from({ length: cols }, (_, i) => ({
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `列 ${i + 1}` }] }],
            })),
          }
          const bodyRows = Array.from({ length: rows - 1 }, () => ({
            type: 'tableRow',
            content: Array.from({ length: cols }, () => ({
              type: 'tableCell',
              content: [{ type: 'paragraph' }],
            })),
          }))
          return commands.insertContent({
            type: 'table',
            content: [headerRow, ...bodyRows],
          })
        },
      addTableRowBefore: () => wrapPmCommand(addRowBefore),
      addTableRowAfter: () => wrapPmCommand(addRowAfter),
      deleteTableRow: () => wrapPmCommand(deleteRow),
      addTableColumnBefore: () => wrapPmCommand(addColumnBefore),
      addTableColumnAfter: () => wrapPmCommand(addColumnAfter),
      deleteTableColumn: () => wrapPmCommand(deleteColumn),
      deleteGfmTable: () => wrapPmCommand(deleteTable),
    }
  },
})

export const MD_TABLE_EXTENSIONS = [MdTable, MdTableRow, MdTableHeader, MdTableCell]
