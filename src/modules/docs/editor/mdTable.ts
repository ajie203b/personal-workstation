import { Node, mergeAttributes } from '@tiptap/core'
import {
  addRow,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  selectedRect,
  tableEditing,
  TableMap,
} from '@tiptap/pm/tables'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

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
      exitGfmTable: () => ReturnType
    }
  }
}

export function isCursorInTable(state: EditorState): boolean {
  return isInTable(state)
}

function wrapPmCommand(pmCmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => pmCmd(state, dispatch)
}

function moveToNextTableRow(state: EditorState, dispatch: (tr: Transaction) => void, firstColumn = false) {
  if (!isInTable(state)) return false
  const rect = selectedRect(state)
  const tr = state.tr
  let { map } = rect
  if (rect.bottom === map.height) {
    addRow(tr, rect, rect.bottom)
    map = TableMap.get(tr.doc.nodeAt(rect.tableStart - 1)!)
  }
  const cell = map.map[rect.bottom * map.width + (firstColumn ? 0 : rect.left)]
  dispatch(tr.setSelection(TextSelection.create(tr.doc, rect.tableStart + cell + 1)).scrollIntoView())
  return true
}

function parseCellAlign(dom: HTMLElement): 'left' | 'center' | 'right' | null {
  const raw = (dom.style?.textAlign || dom.getAttribute('align') || '').trim().toLowerCase()
  return raw === 'left' || raw === 'center' || raw === 'right' ? raw : null
}

function alignSeparator(align: unknown): string {
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  if (align === 'left') return ':---'
  return '---'
}

export const MdTableCell = Node.create({
  name: 'tableCell',
  content: 'inline*',
  isolating: true,
  extendNodeSchema(extension) {
    return extension.name === 'tableCell' ? { tableRole: 'cell' } : {}
  },
  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      textAlign: {
        default: null,
        parseHTML: (el) => parseCellAlign(el),
        renderHTML: (attrs) => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
      },
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
  content: 'inline*',
  isolating: true,
  extendNodeSchema(extension) {
    return extension.name === 'tableHeader' ? { tableRole: 'header_cell' } : {}
  },
  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      textAlign: {
        default: null,
        parseHTML: (el) => parseCellAlign(el),
        renderHTML: (attrs) => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
      },
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

  addStorage() {
    return {
      markdown: {
        serialize(state, table) {
          // tiptap-markdown 自带的表格序列化器要求每格包一层 paragraph。
          const output = state as typeof state & { out: string }
          table.forEach((row, _, rowIndex) => {
            state.write('| ')
            row.forEach((cell, _, columnIndex) => {
              if (columnIndex) state.write(' | ')
              const start = output.out.length
              state.renderInline(cell, false)
              const value = output.out
                .slice(start)
                .replace(/(\\*)(\|)/g, (_m, bs: string) => (bs.length % 2 === 1 ? `${bs}|` : `${bs}\\|`))
                .replace(/\\?\r?\n/g, ' ')
              output.out = output.out.slice(0, start) + value
            })
            state.write(' |')
            state.ensureNewLine()
            if (rowIndex === 0) {
              const seps: string[] = []
              row.forEach((cell) => {
                seps.push(alignSeparator(cell.attrs.textAlign))
              })
              state.write(`| ${seps.join(' | ')} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(table)
        },
      } satisfies MarkdownNodeSpec,
    }
  },

  addProseMirrorPlugins() {
    return [tableEditing()]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor
        if (state.selection instanceof TextSelection && state.selection.empty && isInTable(state)) {
          const { table, map, bottom } = selectedRect(state)
          if (bottom === map.height && table.lastChild?.children.every((cell) => cell.content.size === 0)) {
            return this.editor.commands.exitGfmTable()
          }
        }
        return moveToNextTableRow(state, view.dispatch)
      },
      ArrowDown: () => {
        const { state, view } = this.editor
        if (!(state.selection instanceof TextSelection) || !state.selection.empty || !isInTable(state)) return false
        const { bottom, map } = selectedRect(state)
        return bottom === map.height && view.endOfTextblock('down') && this.editor.commands.exitGfmTable()
      },
      'Mod-Enter': () => this.editor.commands.exitGfmTable(),
      Tab: () => {
        const { state, view } = this.editor
        return goToNextCell(1)(state, view.dispatch) || moveToNextTableRow(state, view.dispatch, true)
      },
      'Shift-Tab': () => wrapPmCommand(goToNextCell(-1))({ state: this.editor.state, dispatch: this.editor.view.dispatch }),
    }
  },

  addCommands() {
    return {
      insertGfmTable:
        (opts) =>
        ({ commands, state, tr, dispatch }) => {
          if (isInTable(state)) return false
          const rows = Math.max(2, opts?.rows ?? 3)
          const cols = Math.max(1, opts?.cols ?? 3)
          const headerRow = {
            type: 'tableRow',
            content: Array.from({ length: cols }, (_, i) => ({
              type: 'tableHeader',
              content: [{ type: 'text', text: `列 ${i + 1}` }],
            })),
          }
          const bodyRows = Array.from({ length: rows - 1 }, () => ({
            type: 'tableRow',
            content: Array.from({ length: cols }, () => ({
              type: 'tableCell',
            })),
          }))
          const table = {
            type: 'table',
            content: [headerRow, ...bodyRows],
          }
          const start = tr.steps.length
          if (!commands.insertContent(table, { updateSelection: false })) return false
          if (dispatch) {
            let firstCell: number | undefined
            tr.mapping.maps[start]?.forEach((_from, _to, newFrom, newTo) => {
              tr.doc.nodesBetween(newFrom, newTo, (node, pos) => {
                if (node.type === this.type && firstCell == null) firstCell = pos + 3
                return firstCell == null
              })
            })
            if (firstCell != null) tr.setSelection(TextSelection.create(tr.doc, firstCell, firstCell + '列 1'.length))
          }
          return true
        },
      addTableRowBefore: () => wrapPmCommand(addRowBefore),
      addTableRowAfter: () => wrapPmCommand(addRowAfter),
      deleteTableRow: () => wrapPmCommand(deleteRow),
      addTableColumnBefore: () => wrapPmCommand(addColumnBefore),
      addTableColumnAfter: () => wrapPmCommand(addColumnAfter),
      deleteTableColumn: () => wrapPmCommand(deleteColumn),
      deleteGfmTable: () => wrapPmCommand(deleteTable),
      exitGfmTable: () => ({ state, tr, dispatch }) => {
        if (!isInTable(state)) return false
        const { table, tableStart } = selectedRect(state)
        const afterTable = tableStart - 1 + table.nodeSize
        if (dispatch) {
          const next = tr.doc.nodeAt(afterTable)
          if (!next?.isTextblock) tr.insert(afterTable, state.schema.nodes.paragraph.create())
          tr.setSelection(TextSelection.create(tr.doc, afterTable + 1)).scrollIntoView()
        }
        return true
      },
    }
  },
})

export const MD_TABLE_EXTENSIONS = [MdTable, MdTableRow, MdTableHeader, MdTableCell]
